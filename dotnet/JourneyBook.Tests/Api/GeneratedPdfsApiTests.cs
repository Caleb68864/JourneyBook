using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Projects;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace JourneyBook.Tests.Api;

public class GeneratedPdfsApiTests(PostgisApiFactory factory) : IClassFixture<PostgisApiFactory>
{
    private readonly PostgisApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<Guid> CreateProjectAsync(string name = "Generated PDF Host")
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest(name, "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        return created!.Id;
    }

    [Fact]
    public async Task Create_starts_pending_with_a_retention_window()
    {
        var projectId = await CreateProjectAsync();

        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs",
            new CreateGeneratedPdfRequest());
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var created = await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>();
        Assert.NotNull(created);
        Assert.Equal(projectId, created!.ProjectId);
        Assert.Equal("Pending", created.Status);
        Assert.NotNull(created.ExpiresAt);
        Assert.True(created.ExpiresAt > created.CreatedAt);
    }

    [Fact]
    public async Task Create_under_unknown_project_returns_404()
    {
        var post = await _client.PostAsJsonAsync($"/api/projects/{Guid.NewGuid()}/generated-pdfs",
            new CreateGeneratedPdfRequest());
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);
    }

    [Fact]
    public async Task Update_status_to_completed_persists_file_path()
    {
        var projectId = await CreateProjectAsync();
        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs",
            new CreateGeneratedPdfRequest());
        var created = await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>();

        var put = await _client.PutAsJsonAsync($"/api/generated-pdfs/{created!.Id}/status",
            new UpdateGeneratedPdfStatusRequest("Completed", "data/generated/atlas.pdf"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var updated = await put.Content.ReadFromJsonAsync<GeneratedPdfResponse>();
        Assert.NotNull(updated);
        Assert.Equal("Completed", updated!.Status);
        Assert.Equal("data/generated/atlas.pdf", updated.FilePath);

        // Survives a reload.
        var reloaded = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{created.Id}");
        Assert.NotNull(reloaded);
        Assert.Equal("Completed", reloaded!.Status);
        Assert.Equal("data/generated/atlas.pdf", reloaded.FilePath);
    }

    [Fact]
    public async Task Source_metadata_snapshot_round_trips_as_jsonb()
    {
        var projectId = await CreateProjectAsync();

        const string snapshot = """{"scale":"usgs-7-5-min","tier":2,"build":"abc123"}""";
        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs",
            new CreateGeneratedPdfRequest(snapshot));
        var created = await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>();
        Assert.NotNull(created);
        // jsonb normalizes key order/whitespace, so compare semantically, not byte-for-byte.
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(snapshot), JsonNode.Parse(created!.SourceMetadataSnapshot!)));

        var fetched = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{created.Id}");
        Assert.NotNull(fetched);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(snapshot), JsonNode.Parse(fetched!.SourceMetadataSnapshot!)));
    }

    [Fact]
    public async Task Prune_removes_expired_records_and_returns_the_count()
    {
        var projectId = await CreateProjectAsync();
        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs",
            new CreateGeneratedPdfRequest());
        var created = await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>();

        // Seed an expired record by pushing ExpiresAt into the past directly.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
            var pdf = await db.GeneratedPdfs.FirstAsync(g => g.Id == created!.Id);
            pdf.ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1);
            await db.SaveChangesAsync();
        }

        var prune = await _client.PostAsync("/api/generated-pdfs/prune", null);
        Assert.Equal(HttpStatusCode.OK, prune.StatusCode);

        var result = await prune.Content.ReadFromJsonAsync<PruneResult>();
        Assert.NotNull(result);
        Assert.True(result!.Deleted >= 1);

        var get = await _client.GetAsync($"/api/generated-pdfs/{created!.Id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_project_cascades_to_its_generated_pdf_records()
    {
        var projectId = await CreateProjectAsync("Cascade Host");
        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs",
            new CreateGeneratedPdfRequest());
        var created = await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>();

        var del = await _client.DeleteAsync($"/api/projects/{projectId}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var get = await _client.GetAsync($"/api/generated-pdfs/{created!.Id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Get_unknown_record_returns_404()
    {
        var get = await _client.GetAsync($"/api/generated-pdfs/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Prune_does_not_delete_files_outside_the_generated_dir()
    {
        // Path-confinement guard (red-team C-1): a FilePath that resolves outside
        // GeneratedDir (here, an absolute path into the temp dir) must be skipped by
        // prune, not deleted — while the DB record is still removed.
        var sentinel = Path.Combine(Path.GetTempPath(), $"jb-prune-sentinel-{Guid.NewGuid():N}.txt");
        await File.WriteAllTextAsync(sentinel, "must survive prune");
        try
        {
            var projectId = await CreateProjectAsync("Confinement Host");
            var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs",
                new CreateGeneratedPdfRequest());
            var created = await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>();

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
                var pdf = await db.GeneratedPdfs.FirstAsync(g => g.Id == created!.Id);
                pdf.FilePath = sentinel; // escapes GeneratedDir
                pdf.ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1);
                await db.SaveChangesAsync();
            }

            var prune = await _client.PostAsync("/api/generated-pdfs/prune", null);
            Assert.Equal(HttpStatusCode.OK, prune.StatusCode);

            // The out-of-confinement file MUST survive; the record MUST still be pruned.
            Assert.True(File.Exists(sentinel), "prune must not delete files outside GeneratedDir");
            var get = await _client.GetAsync($"/api/generated-pdfs/{created!.Id}");
            Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        }
        finally
        {
            if (File.Exists(sentinel)) File.Delete(sentinel);
        }
    }
}

using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Projects;
using JourneyBook.Domain;
using JourneyBook.Infrastructure.Persistence;
using JourneyBook.Infrastructure.Rendering;
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

    /// <summary>
    /// Startup reconciliation, against the real database: the query, not the caller.
    /// </summary>
    /// <remarks>
    /// The strand was fixed only for a graceful shutdown. After a <c>SIGKILL</c>, an
    /// OOM kill, a container crash or power loss there is no shutdown path at all, and
    /// retention cannot stand in for one: <c>PruneExpiredAsync</c> selects on
    /// <c>ExpiresAt &lt; now</c>, and a row a crash stranded ten seconds ago carries a
    /// 30-day <c>ExpiresAt</c> and is not expired. Every row below has a **future**
    /// expiry for exactly that reason — prune would not touch one of them.
    /// </remarks>
    [Fact]
    public async Task Fail_stranded_moves_pending_and_rendering_rows_and_leaves_finished_ones()
    {
        var projectId = await CreateProjectAsync("Crash Wreckage");

        async Task<Guid> RowAsync(string? status)
        {
            var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/generated-pdfs",
                new CreateGeneratedPdfRequest());
            var row = await post.Content.ReadFromJsonAsync<GeneratedPdfResponse>();
            Assert.NotNull(row);
            if (status is not null)
            {
                var put = await _client.PutAsJsonAsync($"/api/generated-pdfs/{row!.Id}/status",
                    new UpdateGeneratedPdfStatusRequest(status, "data/generated/atlas.pdf"));
                Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            }
            return row!.Id;
        }

        var pending = await RowAsync(null);            // never started
        var rendering = await RowAsync("Rendering");   // died mid-render
        var completed = await RowAsync("Completed");   // finished before the crash

        // The fixture reached the subject: these are the states the sweep must
        // distinguish, and they really are in the database in those states.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
            Assert.Equal(PdfStatus.Pending, (await db.GeneratedPdfs.FirstAsync(g => g.Id == pending)).Status);
            Assert.Equal(PdfStatus.Rendering, (await db.GeneratedPdfs.FirstAsync(g => g.Id == rendering)).Status);
            // Not expired — prune would leave every one of these alone.
            Assert.True(
                await db.GeneratedPdfs.Where(g => g.Id == pending).AllAsync(g => g.ExpiresAt > DateTimeOffset.UtcNow),
                "a crash-stranded row is not an expired row; that is the whole point");
        }

        int swept;
        using (var scope = _factory.Services.CreateScope())
        {
            var pdfs = scope.ServiceProvider.GetRequiredService<IGeneratedPdfService>();
            swept = await pdfs.FailStrandedAsync(RenderJobProcessor.StrandedByRestartMessage);
        }
        Assert.True(swept >= 2, $"sweep reconciled {swept} row(s); expected at least the two above");

        var strandedRow = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{pending}");
        Assert.Equal("Failed", strandedRow!.Status);
        Assert.Equal(RenderJobProcessor.StrandedByRestartMessage, strandedRow.ErrorMessage);

        var midRender = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{rendering}");
        Assert.Equal("Failed", midRender!.Status);
        // A half-written file is not a download.
        Assert.Null(midRender.FilePath);

        // A finished render is not wreckage.
        var done = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{completed}");
        Assert.Equal("Completed", done!.Status);
        Assert.Equal("data/generated/atlas.pdf", done.FilePath);
        Assert.Null(done.ErrorMessage);
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

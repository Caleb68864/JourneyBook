using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Projects;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;

namespace JourneyBook.Tests.Api;

// ── Stub ──────────────────────────────────────────────────────────────────────

public sealed class FakeRenderWorkerClient(string generatedDir) : IRenderWorkerClient
{
    public bool ShouldFail { get; set; }

    public Task<RenderWorkerResult> RenderAsync(RenderWorkerRequest request, CancellationToken ct = default)
    {
        if (ShouldFail)
            throw new InvalidOperationException("Simulated render worker failure.");

        Directory.CreateDirectory(generatedDir);
        var fullPath = Path.Combine(generatedDir, request.OutputFileName);
        File.WriteAllBytes(fullPath, "%PDF-1.4\n%%EOF\n"u8.ToArray());
        return Task.FromResult(new RenderWorkerResult(request.OutputFileName, 1, null));
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

public sealed class RenderApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder()
        .WithImage("postgis/postgis:16-3.4")
        .WithDatabase("journeybook")
        .WithUsername("journeybook")
        .WithPassword("journeybook")
        .Build();

    public string GeneratedDir { get; } =
        Path.Combine(Path.GetTempPath(), $"jb-render-test-{Guid.NewGuid():N}");

    // Set after the first CreateClient() call (triggers ConfigureWebHost).
    public FakeRenderWorkerClient FakeClient { get; private set; } = null!;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Postgres", _db.GetConnectionString());
        builder.UseSetting("GeneratedPdf:GeneratedDir", GeneratedDir);

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IRenderWorkerClient>();
            FakeClient = new FakeRenderWorkerClient(GeneratedDir);
            services.AddSingleton<IRenderWorkerClient>(FakeClient);
        });
    }

    public async Task InitializeAsync()
    {
        await _db.StartAsync();
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>()
            .Database.MigrateAsync();
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await _db.DisposeAsync();
        if (Directory.Exists(GeneratedDir))
            Directory.Delete(GeneratedDir, recursive: true);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

public class RenderApiTests(RenderApiFactory factory) : IClassFixture<RenderApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<Guid> CreateProjectAsync(string name = "Render Test Project")
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest(name, "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        // Give the project a renderable extent (a bbox grid) — RenderService now
        // rejects projects with neither an extent nor any locations (400).
        var ext = await _client.PutAsJsonAsync($"/api/projects/{created!.Id}/extent",
            new BBoxDto(-96.75, 40.78, -96.65, 40.85));
        Assert.Equal(HttpStatusCode.OK, ext.StatusCode);
        return created.Id;
    }

    [Fact]
    public async Task Render_with_no_extent_or_locations_returns_400()
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Empty Render Project", "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);

        var resp = await _client.PostAsJsonAsync($"/api/projects/{created!.Id}/render",
            new RenderProjectRequest());
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Render_returns_200_and_transitions_record_to_completed()
    {
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync();

        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest(Tier: 1));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);
        Assert.Equal("Completed", body!.Status);
        Assert.Contains("/content", body.DownloadUrl);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
        var pdf = await db.GeneratedPdfs.FirstOrDefaultAsync(g => g.Id == body.GeneratedPdfId);
        Assert.NotNull(pdf);
        Assert.Equal(JourneyBook.Domain.PdfStatus.Completed, pdf!.Status);
    }

    [Fact]
    public async Task Content_endpoint_returns_pdf_bytes_for_completed_record()
    {
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync("Content DL Project");

        var renderResp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest());
        Assert.Equal(HttpStatusCode.OK, renderResp.StatusCode);

        var body = await renderResp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);

        var contentResp = await _client.GetAsync(body!.DownloadUrl);
        Assert.Equal(HttpStatusCode.OK, contentResp.StatusCode);
        Assert.Equal("application/pdf", contentResp.Content.Headers.ContentType?.MediaType);
        Assert.True((await contentResp.Content.ReadAsByteArrayAsync()).Length > 0);
    }

    [Fact]
    public async Task Worker_failure_records_failed_status_and_returns_502()
    {
        factory.FakeClient.ShouldFail = true;
        try
        {
            var projectId = await CreateProjectAsync("Worker Failure Project");

            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest());
            Assert.Equal(HttpStatusCode.BadGateway, resp.StatusCode);

            var body = await resp.Content.ReadFromJsonAsync<RenderFailedResponse>();
            Assert.NotNull(body);
            Assert.NotEqual(Guid.Empty, body!.GeneratedPdfId);
            Assert.False(string.IsNullOrEmpty(body.Error));

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
            var pdf = await db.GeneratedPdfs.FirstOrDefaultAsync(g => g.Id == body.GeneratedPdfId);
            Assert.NotNull(pdf);
            Assert.Equal(JourneyBook.Domain.PdfStatus.Failed, pdf!.Status);
        }
        finally
        {
            factory.FakeClient.ShouldFail = false;
        }
    }

    [Fact]
    public async Task Render_unknown_project_returns_404()
    {
        factory.FakeClient.ShouldFail = false;
        var resp = await _client.PostAsJsonAsync($"/api/projects/{Guid.NewGuid()}/render",
            new RenderProjectRequest());
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Content_endpoint_rejects_path_traversal()
    {
        var projectId = await CreateProjectAsync("Path Confinement Project");

        using var setupScope = factory.Services.CreateScope();
        var db = setupScope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();

        var pdf = new JourneyBook.Domain.Entities.GeneratedPdf
        {
            ProjectId = projectId,
            Status = JourneyBook.Domain.PdfStatus.Completed,
            FilePath = "../../etc/passwd",
            CreatedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(30),
        };
        db.GeneratedPdfs.Add(pdf);
        await db.SaveChangesAsync();

        var resp = await _client.GetAsync($"/api/generated-pdfs/{pdf.Id}/content");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}

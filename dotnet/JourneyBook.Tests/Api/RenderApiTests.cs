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

    /// <summary>Held open to keep a render "in flight" while a test observes it.</summary>
    public TaskCompletionSource? Gate { get; set; }

    public async Task<RenderWorkerResult> RenderAsync(RenderWorkerRequest request, CancellationToken ct = default)
    {
        if (Gate is not null)
            await Gate.Task.WaitAsync(TimeSpan.FromSeconds(30), ct);

        if (ShouldFail)
            throw new InvalidOperationException("Simulated render worker failure.");

        Directory.CreateDirectory(generatedDir);
        var fullPath = Path.Combine(generatedDir, request.OutputFileName);
        await File.WriteAllBytesAsync(fullPath, "%PDF-1.4\n%%EOF\n"u8.ToArray(), ct);
        return new RenderWorkerResult(request.OutputFileName, 1, null);
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

public sealed class RenderApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    // Image in the constructor: the parameterless one is obsolete in Testcontainers 4.x.
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder(TestContainerImages.Postgis)
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

    /// <summary>
    /// Poll the status endpoint the web app polls until the record leaves the
    /// non-terminal states, or fail loudly rather than hang.
    /// </summary>
    private async Task<GeneratedPdfResponse> PollUntilTerminalAsync(Guid pdfId)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        while (DateTimeOffset.UtcNow < deadline)
        {
            var record = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{pdfId}");
            Assert.NotNull(record);
            if (record!.Status is "Completed" or "Failed") return record;
            await Task.Delay(50);
        }

        throw new TimeoutException($"Generated PDF {pdfId} never reached a terminal status.");
    }

    /// <summary>
    /// The POST answers immediately with the record id; the render happens after.
    /// </summary>
    /// <remarks>
    /// This used to be a 200 that did not arrive until the render was finished, so a
    /// 60-page atlas held one HTTP connection open behind an indefinite spinner for
    /// as long as 60 sequential basemap fetches took. Asserting 202 + "Pending" here
    /// is what fails if the endpoint ever goes back to blocking.
    /// </remarks>
    [Fact]
    public async Task Render_returns_202_immediately_with_a_pending_record()
    {
        factory.FakeClient.ShouldFail = false;
        // Hold the worker open so the assertions below observe the accepted state
        // rather than racing a fake render that finishes in microseconds.
        var gate = new TaskCompletionSource();
        factory.FakeClient.Gate = gate;
        try
        {
            var projectId = await CreateProjectAsync();

            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest(Tier: 1));

            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

            var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
            Assert.NotNull(body);
            Assert.Equal("Pending", body!.Status);
            Assert.Contains("/content", body.DownloadUrl);
            Assert.Equal($"/api/generated-pdfs/{body.GeneratedPdfId}", body.StatusUrl);
            // Location names the status resource to poll, not the PDF — which does
            // not exist yet, and will 404 if a client opens it now.
            Assert.Equal(body.StatusUrl, resp.Headers.Location?.ToString());

            var contentTooEarly = await _client.GetAsync(body.DownloadUrl);
            Assert.Equal(HttpStatusCode.NotFound, contentTooEarly.StatusCode);

            // Drain this test's own job before leaving. The queue is shared across the
            // class fixture and drained sequentially, so a job left in flight would
            // run under the NEXT test's gate and ShouldFail setting.
            gate.SetResult();
            await PollUntilTerminalAsync(body.GeneratedPdfId);
        }
        finally
        {
            gate.TrySetResult();
            factory.FakeClient.Gate = null;
        }
    }

    /// <summary>
    /// <c>Rendering</c> is observable while the worker holds the job.
    /// </summary>
    /// <remarks>
    /// The status has existed in the schema since it was written and nothing ever set
    /// it, because the whole render happened inside one blocking call. A polling
    /// client needs it to distinguish "queued behind other work" from "running".
    /// </remarks>
    [Fact]
    public async Task Record_reaches_Rendering_while_the_worker_holds_the_job()
    {
        factory.FakeClient.ShouldFail = false;
        var gate = new TaskCompletionSource();
        factory.FakeClient.Gate = gate;
        try
        {
            var projectId = await CreateProjectAsync("Rendering Status Project");
            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest());
            var body = (await resp.Content.ReadFromJsonAsync<RenderProjectResponse>())!;

            var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
            string? status = null;
            while (DateTimeOffset.UtcNow < deadline && status != "Rendering")
            {
                status = (await _client.GetFromJsonAsync<GeneratedPdfResponse>(
                    $"/api/generated-pdfs/{body.GeneratedPdfId}"))!.Status;
                if (status != "Rendering") await Task.Delay(25);
            }

            Assert.Equal("Rendering", status);

            gate.SetResult();
            var final = await PollUntilTerminalAsync(body.GeneratedPdfId);
            Assert.Equal("Completed", final.Status);
        }
        finally
        {
            gate.TrySetResult();
            factory.FakeClient.Gate = null;
        }
    }

    [Fact]
    public async Task Content_endpoint_returns_pdf_bytes_once_polling_reports_completed()
    {
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync("Content DL Project");

        var renderResp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest());
        Assert.Equal(HttpStatusCode.Accepted, renderResp.StatusCode);

        var body = await renderResp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);

        var final = await PollUntilTerminalAsync(body!.GeneratedPdfId);
        Assert.Equal("Completed", final.Status);

        var contentResp = await _client.GetAsync(body.DownloadUrl);
        Assert.Equal(HttpStatusCode.OK, contentResp.StatusCode);
        Assert.Equal("application/pdf", contentResp.Content.Headers.ContentType?.MediaType);
        Assert.True((await contentResp.Content.ReadAsByteArrayAsync()).Length > 0);
    }

    /// <summary>
    /// A worker failure is no longer an outcome of the POST, so the record has to
    /// carry the diagnostic — otherwise the user's whole answer is the word "Failed".
    /// </summary>
    [Fact]
    public async Task Worker_failure_lands_on_the_record_with_its_diagnostic()
    {
        factory.FakeClient.ShouldFail = true;
        try
        {
            var projectId = await CreateProjectAsync("Worker Failure Project");

            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest());
            // Accepted: the request succeeded. The RENDER is what failed, later.
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

            var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
            Assert.NotNull(body);
            Assert.NotEqual(Guid.Empty, body!.GeneratedPdfId);

            var final = await PollUntilTerminalAsync(body.GeneratedPdfId);
            Assert.Equal("Failed", final.Status);
            Assert.Equal("Simulated render worker failure.", final.ErrorMessage);

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

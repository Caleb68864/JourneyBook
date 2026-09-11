using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Projects;
using JourneyBook.Application.Rendering;
using JourneyBook.Domain;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;
using JourneyBook.Application.Common;

namespace JourneyBook.Tests.Api;

// ── Stub ──────────────────────────────────────────────────────────────────────

public sealed class FakeRenderWorkerClient(string generatedDir) : IRenderWorkerClient
{
    public bool ShouldFail { get; set; }

    /// <summary>Held open to keep a render "in flight" while a test observes it.</summary>
    public TaskCompletionSource? Gate { get; set; }

    /// <summary>
    /// Every request this stub has been handed, keyed by its output file name.
    /// </summary>
    /// <remarks>
    /// A single <c>LastRequest</c> would be wrong here and quietly so: the factory
    /// is an <c>IClassFixture</c> shared by every test in the class, and the
    /// render itself is performed by a BACKGROUND queue processor, so the request
    /// that lands last is not necessarily the one the asserting test started.
    /// Keying on <c>atlas-{generatedPdfId:N}.pdf</c> — which the caller knows from
    /// the 202 body — makes each assertion about its own render.
    /// </remarks>
    public System.Collections.Concurrent.ConcurrentDictionary<string, RenderWorkerRequest> Requests { get; } = new();

    /// <summary>Progress the stub reports before answering, standing in for the worker's job polls.</summary>
    public IReadOnlyList<RenderProgressUpdate> Emits { get; set; } = [];

    /// <summary>
    /// The credit the stub reports having printed, as the real worker does.
    /// </summary>
    /// <remarks>
    /// Was hardcoded null, which is why nothing noticed that the value had no
    /// reader on the other side: a stub that always reports nothing cannot show
    /// that nothing is done with what it reports.
    /// </remarks>
    public string? Attribution { get; set; }

    /// <summary>
    /// The print resolution the stub reports having achieved, as the real worker
    /// does.
    /// </summary>
    /// <remarks>
    /// Settable for the same reason <see cref="Attribution"/> is: a stub that
    /// always reports nothing cannot show that nothing is done with what it
    /// reports, and that is exactly how this value came to be written to a log
    /// stream and to no record.
    /// </remarks>
    public RenderDeliveredDpi? DeliveredDpi { get; set; }

    public async Task<RenderWorkerResult> RenderAsync(
        RenderWorkerRequest request,
        RenderProgressHandler? onProgress = null,
        CancellationToken ct = default)
    {
        Requests[request.OutputFileName] = request;

        foreach (var emit in Emits)
        {
            if (onProgress is not null) await onProgress(emit, ct);
        }

        if (Gate is not null)
            await Gate.Task.WaitAsync(TimeSpan.FromSeconds(30), ct);

        if (ShouldFail)
            throw new InvalidOperationException("Simulated render worker failure.");

        Directory.CreateDirectory(generatedDir);
        var fullPath = Path.Combine(generatedDir, request.OutputFileName);
        await File.WriteAllBytesAsync(fullPath, "%PDF-1.4\n%%EOF\n"u8.ToArray(), ct);

        // The page count this stub REPORTED, not a constant.
        //
        // It used to return 1 unconditionally while `Emits` announced a 12-page
        // render — a stub that contradicts itself, which was invisible for as long
        // as the count only ever reached the record through a progress write. Now
        // that a finished render records its own authoritative count (a render
        // completing inside one poll interval emits no progress at all, and used to
        // reach `Completed` with no count), the two writes are both real and the
        // second one is the truth. A fixture that reports 12 and returns 1 makes the
        // honest behaviour look like a bug.
        //
        // The real worker cannot disagree with itself this way: `JobStore.complete`
        // sets `record.pageCount` from the same render result the progress events
        // counted towards.
        var reported = Emits.Count > 0 && Emits[^1].PageCount > 0 ? Emits[^1].PageCount : 1;
        return new RenderWorkerResult(request.OutputFileName, reported, Attribution, DeliveredDpi);
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
        var seen = new List<string>();
        GeneratedPdfResponse? last = null;

        while (DateTimeOffset.UtcNow < deadline)
        {
            var record = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{pdfId}");
            Assert.NotNull(record);
            last = record;
            if (seen.Count == 0 || seen[^1] != record!.Status) seen.Add(record.Status);

            // The real terminal set, not a hand-written copy of it. This helper said
            // `"Completed" or "Failed"` and so polled a Cancelled record for the whole
            // thirty seconds before reporting a timeout that had not happened — the
            // exact failure PdfStatusParityTests describes for a client that has not
            // heard of a status, committed in the same change that added one.
            if (Enum.TryParse<PdfStatus>(record!.Status, out var parsed) && parsed.IsTerminal())
                return record;
            await Task.Delay(50);
        }

        // Say what actually happened. A bare "never reached a terminal status" after
        // thirty seconds is the worst thing to hand the next person: it cannot
        // distinguish "the render is stuck" from "it finished in a state this helper
        // does not recognise", and those have opposite fixes. That ambiguity cost a
        // CI run, so the message now carries the state the record was actually in,
        // every transition it made, and the set being compared against.
        var terminal = string.Join(", ", Enum.GetValues<PdfStatus>().Where(s => s.IsTerminal()));
        throw new TimeoutException(
            $"Generated PDF {pdfId} never reached a terminal status in 30s. " +
            $"Last status: '{last?.Status ?? "<no record>"}' " +
            $"(progress {last?.Progress?.ToString() ?? "-"}/{last?.PageCount?.ToString() ?? "-"}, " +
            $"error: {last?.ErrorMessage ?? "<none>"}). " +
            $"Transitions seen: {(seen.Count > 0 ? string.Join(" -> ", seen) : "<none>")}. " +
            $"Statuses this helper accepts as terminal: {terminal}. " +
            "If the last status IS in that list the poll is looking in the wrong place; " +
            "if it is Pending or Rendering the render genuinely did not settle.");
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

    // ── Progress and cancel over the wire (ADR 0007) ─────────────────────────

    [Fact]
    public async Task Progress_the_worker_reports_reaches_the_status_resource()
    {
        // The last hop of the chain, and the one the half-wired trap lives on: the
        // engine can report, the worker can record and the runner can write, and if
        // GeneratedPdfResponse does not carry the fields the browser still sees
        // nothing. Every value crossing a new boundary has to be proven to arrive.
        factory.FakeClient.ShouldFail = false;
        factory.FakeClient.Emits = [new RenderProgressUpdate(7, 12, "panel")];
        try
        {
            var projectId = await CreateProjectAsync("Progress Project");
            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest());
            var body = (await resp.Content.ReadFromJsonAsync<RenderProjectResponse>())!;

            var final = await PollUntilTerminalAsync(body.GeneratedPdfId);
            Assert.Equal("Completed", final.Status);

            // `Progress` can ONLY have come from the progress write — the completion
            // write carries no progress — so this is the assertion that proves the
            // reports arrived at all, and it must be read before the one below.
            Assert.True(
                final.Progress == 7,
                $"Progress is {final.Progress?.ToString() ?? "null"}, expected 7. Only " +
                "UpdateProgressAsync writes this field, so a null means no progress report " +
                "reached the record (check the handler in RenderJobRunner and the distinct-position " +
                "filter in HttpRenderWorkerClient); a different number means the wrong report " +
                "was the last one written.");

            // The denominator. TWO writers now carry a page count — the progress
            // report, and the completion write with the finished render's own
            // authoritative count — so a wrong value here has to say WHICH one
            // produced it or the next reader is left with "12 versus 1".
            Assert.True(
                final.PageCount == 12,
                $"PageCount is {final.PageCount?.ToString() ?? "null"}, expected 12 (the count " +
                "this test's progress report announced).\n" +
                $"  Progress on the same record is {final.Progress?.ToString() ?? "null"}, status is {final.Status}.\n" +
                "  null  → neither writer ran: no progress report arrived AND the completion write " +
                "did not carry a count.\n" +
                "  1     → the COMPLETION write won, carrying FakeRenderWorkerClient's returned " +
                "RenderWorkerResult.PageCount. That is correct behaviour against a stub that reports " +
                "a 12-page render in Emits and then returns a 1-page result — fix the stub, not the " +
                "runner. The real worker cannot disagree with itself: JobStore.complete sets " +
                "record.pageCount from the same result the progress events counted towards.\n" +
                "  other → the last progress report written was not the one this test emitted.");
            // …and NOT the phase. A terminal row that still says "panel" is a record
            // claiming to be doing something it finished doing.
            Assert.Null(final.Phase);
        }
        finally
        {
            factory.FakeClient.Emits = [];
        }
    }

    /// <summary>
    /// The engine's phase reaches the status resource while the render is in flight.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The hop that was missing. The engine reports a phase, the worker records it,
    /// <c>HttpRenderWorkerClient</c> parses it into <c>RenderProgressUpdate.Phase</c>
    /// — documented there at length as "carried verbatim rather than
    /// re-interpreted" — and <c>UpdateGeneratedPdfProgressRequest</c> had no member
    /// for it, so the only reader anywhere in the repo was a unit test.
    /// </para>
    /// <para>
    /// Deliberately phase <c>pdf</c> with <c>Progress == PageCount</c>: those are the
    /// numbers a finished render reports too, so a client reading only the numbers
    /// draws a full bar for the whole of PDF assembly. The phase is the only field
    /// that separates "nearly done" from "stalled", which is why a test that
    /// asserted the numbers and ignored the word could not see this.
    /// </para>
    /// <para>
    /// Held open with the gate rather than polled to completion, because the phase
    /// is deliberately cleared on a terminal status — the test above pins that half.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task The_engines_phase_reaches_the_status_resource_while_rendering()
    {
        factory.FakeClient.ShouldFail = false;
        var gate = new TaskCompletionSource();
        factory.FakeClient.Gate = gate;
        factory.FakeClient.Emits = [new RenderProgressUpdate(9, 9, "pdf")];
        try
        {
            var projectId = await CreateProjectAsync("Phase Project");
            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest());
            var body = (await resp.Content.ReadFromJsonAsync<RenderProjectResponse>())!;

            var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
            GeneratedPdfResponse? seen = null;
            while (DateTimeOffset.UtcNow < deadline && seen?.Phase is null)
            {
                seen = await _client.GetFromJsonAsync<GeneratedPdfResponse>(
                    $"/api/generated-pdfs/{body.GeneratedPdfId}");
                if (seen?.Phase is null) await Task.Delay(25);
            }

            Assert.NotNull(seen);
            Assert.Equal("pdf", seen!.Phase);
            // The two numbers a client would otherwise have to draw a finished bar
            // from, on a render that is still going.
            Assert.Equal(9, seen.Progress);
            Assert.Equal(9, seen.PageCount);
            Assert.Equal("Rendering", seen.Status);

            gate.SetResult();
            var final = await PollUntilTerminalAsync(body.GeneratedPdfId);
            Assert.Equal("Completed", final.Status);
            Assert.Null(final.Phase);
        }
        finally
        {
            gate.TrySetResult();
            factory.FakeClient.Gate = null;
            factory.FakeClient.Emits = [];
        }
    }

    [Fact]
    public async Task Cancelling_an_in_flight_render_settles_the_record_at_Cancelled()
    {
        factory.FakeClient.ShouldFail = false;
        var gate = new TaskCompletionSource();
        factory.FakeClient.Gate = gate;
        try
        {
            var projectId = await CreateProjectAsync("Cancel Project");
            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest());
            var body = (await resp.Content.ReadFromJsonAsync<RenderProjectResponse>())!;

            // Wait until the worker actually has it, so this cancels a render in
            // flight rather than one still queued — two different code paths, and the
            // queued one is covered by RenderJobRunnerTests.
            var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
            string? status = null;
            while (DateTimeOffset.UtcNow < deadline && status != "Rendering")
            {
                status = (await _client.GetFromJsonAsync<GeneratedPdfResponse>(
                    $"/api/generated-pdfs/{body.GeneratedPdfId}"))!.Status;
                if (status != "Rendering") await Task.Delay(25);
            }
            Assert.Equal("Rendering", status);

            var cancel = await _client.PostAsync($"/api/generated-pdfs/{body.GeneratedPdfId}/cancel", null);
            // 202: asked for, not done. The record settles when the render stops.
            Assert.Equal(HttpStatusCode.Accepted, cancel.StatusCode);

            // The stub is waiting on the gate with the linked token, so the cancel
            // reaches it the same way it reaches the real worker's DELETE.
            var final = await PollUntilTerminalAsync(body.GeneratedPdfId);
            Assert.Equal("Cancelled", final.Status);
            // Cancelled, not Failed, and it says so rather than leaving the user to
            // hunt for a diagnostic that does not exist.
            Assert.NotNull(final.ErrorMessage);
            Assert.DoesNotContain("shut down", final.ErrorMessage!, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            gate.TrySetResult();
            factory.FakeClient.Gate = null;
        }
    }

    [Fact]
    public async Task Cancelling_a_finished_render_is_a_conflict_not_a_cancellation()
    {
        // CONTROL, must be refused. A cancel that answers 202 for a render that is
        // already over is the same class of lie as reporting a timeout as a cancel:
        // the client waits for a transition that will never come.
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync("Late Cancel Project");
        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest());
        var body = (await resp.Content.ReadFromJsonAsync<RenderProjectResponse>())!;

        var final = await PollUntilTerminalAsync(body.GeneratedPdfId);
        Assert.Equal("Completed", final.Status);

        var cancel = await _client.PostAsync($"/api/generated-pdfs/{body.GeneratedPdfId}/cancel", null);
        Assert.Equal(HttpStatusCode.Conflict, cancel.StatusCode);
        Assert.Equal("Completed", (await _client.GetFromJsonAsync<GeneratedPdfResponse>(
            $"/api/generated-pdfs/{body.GeneratedPdfId}"))!.Status);
    }

    [Fact]
    public async Task Cancelling_an_unknown_render_is_a_404()
    {
        var cancel = await _client.PostAsync($"/api/generated-pdfs/{Guid.NewGuid()}/cancel", null);
        Assert.Equal(HttpStatusCode.NotFound, cancel.StatusCode);
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

    // ── Basemap panel knobs (F08) ────────────────────────────────────────────

    /// <summary>
    /// The knobs survive the whole API path: JSON body → <c>RenderProjectRequest</c>
    /// → <c>RenderService</c> → the queued <c>RenderWorkerRequest</c>.
    /// </summary>
    /// <remarks>
    /// <c>HttpRenderWorkerClientTests</c> proves the last hop (request → wire JSON);
    /// this proves the hops before it, which is where <c>Basemap</c> was lost — it
    /// existed nowhere on this path at all and the client simply hardcoded
    /// <c>true</c>. Every value here is non-default, so a layer that drops one and
    /// substitutes its own cannot pass.
    /// </remarks>
    [Fact]
    public async Task Render_forwards_basemap_off_and_the_panel_knobs_to_the_worker_request()
    {
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync("Panel Knob Project");

        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest(
                Tier: 2, Basemap: false, PanelWidthPx: 2048, PanelFormat: "png", PanelQuality: 55));

        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);
        await PollUntilTerminalAsync(body!.GeneratedPdfId);

        // Keyed on THIS render's output name — the fixture and its queue are shared
        // with every other test in the class.
        var outputFileName = $"atlas-{body.GeneratedPdfId:N}.pdf";
        Assert.True(
            factory.FakeClient.Requests.TryGetValue(outputFileName, out var sent),
            $"the worker was never handed a request for {outputFileName}");

        Assert.False(sent!.Basemap);
        Assert.Equal(2048, sent.PanelWidthPx);
        Assert.Equal("png", sent.PanelFormat);
        Assert.Equal(55, sent.PanelQuality);
    }

    /// <summary>
    /// [CONTROL] A request that names no knob must reach the worker exactly as it
    /// always did: basemap on, and the three panel fields unset so the engine keeps
    /// its own per-preset defaults.
    /// </summary>
    [Fact]
    public async Task Render_without_panel_knobs_still_asks_for_a_basemap_and_sets_nothing_else()
    {
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync("Default Knob Project");

        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest(Tier: 1));

        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);
        await PollUntilTerminalAsync(body!.GeneratedPdfId);

        Assert.True(
            factory.FakeClient.Requests.TryGetValue($"atlas-{body.GeneratedPdfId:N}.pdf", out var sent),
            "the worker was never handed this render's request");

        Assert.True(sent!.Basemap);
        Assert.Null(sent.PanelWidthPx);
        Assert.Null(sent.PanelFormat);
        Assert.Null(sent.PanelQuality);
    }

    /// <summary>
    /// A finished render's record carries the provenance the record is declared for.
    /// </summary>
    /// <remarks>
    /// The last hop of the attribution chain, and the one that was missing: the
    /// engine collects the credit it actually printed, the worker returns it, the
    /// client parses it into <c>RenderWorkerResult.Attribution</c> — and nothing in
    /// the repo read that property. Meanwhile <c>SourceMetadataSnapshot</c>, whose
    /// declared content is "tile sources, attribution, scale at render time", was
    /// null on every record a render ever produced because the only way to set it
    /// was on CREATE, before the render had happened. Asserted through the public
    /// status resource, which is where a client would look for it.
    /// </remarks>
    [Fact]
    public async Task A_completed_record_carries_the_attribution_and_page_count_of_its_render()
    {
        factory.FakeClient.ShouldFail = false;
        factory.FakeClient.Attribution = "USGS The National Map · OpenStreetMap";
        try
        {
            var projectId = await CreateProjectAsync("Provenance Project");
            var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
                new RenderProjectRequest(Tier: 3));
            var body = (await resp.Content.ReadFromJsonAsync<RenderProjectResponse>())!;

            var final = await PollUntilTerminalAsync(body.GeneratedPdfId);
            Assert.Equal("Completed", final.Status);

            Assert.NotNull(final.SourceMetadataSnapshot);
            using var doc = System.Text.Json.JsonDocument.Parse(final.SourceMetadataSnapshot!);
            Assert.Equal(
                "USGS The National Map · OpenStreetMap",
                doc.RootElement.GetProperty("attribution").GetString());
            Assert.Equal(3, doc.RootElement.GetProperty("tier").GetInt32());

            // And the page count, which this render never reported as progress —
            // `Emits` is empty, so before this the row finished with no count at all.
            Assert.Equal(1, final.PageCount);
        }
        finally
        {
            factory.FakeClient.Attribution = null;
        }
    }

    /// <summary>
    /// The project's own name reaches the worker request as the atlas title.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The hop this covers is <c>RenderService</c>: <c>project.Name</c> was loaded on
    /// every render — it is part of the same <c>Include</c> chain that fetches the
    /// page grid — and <c>RenderWorkerRequest</c> had no member to put it in. The
    /// engine's <c>renderAtlasPdfToFile</c> is <c>title: options.title ?? "Journey
    /// Book"</c>, so the fallback fired for every atlas the API has ever produced:
    /// the name the user typed was on the project list page and on no page of the
    /// book.
    /// </para>
    /// <para>
    /// A deliberately distinctive name, and asserted by equality: "contains a title"
    /// would pass on the string this test exists to prove is gone.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task Render_carries_the_projects_own_name_as_the_atlas_title()
    {
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync("Pawnee Creek Land Nav");

        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest(Tier: 1));

        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);
        await PollUntilTerminalAsync(body!.GeneratedPdfId);

        Assert.True(
            factory.FakeClient.Requests.TryGetValue($"atlas-{body.GeneratedPdfId:N}.pdf", out var sent),
            "the worker was never handed this render's request");

        Assert.Equal("Pawnee Creek Land Nav", sent!.Title);
        Assert.NotEqual("Journey Book", sent.Title);
    }

    /// <summary>
    /// A name that is only whitespace stays null, so the engine's own fallback
    /// applies rather than an atlas titled with a blank line.
    /// </summary>
    /// <remarks>
    /// The shape-5 half of the title fix: where the software knows the answer it
    /// should send it, and where it does not it must not invent one. An empty string
    /// on the wire is not "no title" to the engine — <c>?? "Journey Book"</c> does
    /// not fire on <c>""</c> — so this is the difference between the default and a
    /// nameless book.
    /// </remarks>
    [Fact]
    public async Task A_blank_project_name_sends_no_title_at_all()
    {
        factory.FakeClient.ShouldFail = false;
        // Straight to the database: the create endpoint refuses a blank name, and
        // the case this guards is a row that got one some other way (an import, a
        // migration, a direct write).
        Guid projectId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
            var project = new JourneyBook.Domain.Entities.Project
            {
                Name = "   ",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Projects.Add(project);
            project.Locations.Add(new JourneyBook.Domain.Entities.ImportantLocation
            {
                Name = "Stop",
                LocationNumber = 1,
                Location = NetTopologySuite.NtsGeometryServices.Instance
                    .CreateGeometryFactory(4326).CreatePoint(new NetTopologySuite.Geometries.Coordinate(-96.7, 40.8)),
            });
            await db.SaveChangesAsync();
            projectId = project.Id;
        }

        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest(Tier: 1));

        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);
        await PollUntilTerminalAsync(body!.GeneratedPdfId);

        Assert.True(
            factory.FakeClient.Requests.TryGetValue($"atlas-{body.GeneratedPdfId:N}.pdf", out var sent),
            "the worker was never handed this render's request");

        Assert.Null(sent!.Title);
    }

    /// <summary>
    /// A knob outside the engine's range is a 400 on the POST, not a queued job
    /// that fails minutes later and leaves the user to go and read a Failed row.
    /// </summary>
    [Theory]
    [InlineData(40000, null, null)]
    [InlineData(null, "webp", null)]
    [InlineData(null, null, 120)]
    public async Task Render_with_an_out_of_range_panel_knob_returns_400(
        int? widthPx, string? format, int? quality)
    {
        factory.FakeClient.ShouldFail = false;
        var projectId = await CreateProjectAsync("Bad Knob Project");

        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest(PanelWidthPx: widthPx, PanelFormat: format, PanelQuality: quality));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}

// ── Tile-proxy ceiling ────────────────────────────────────────────────────────

/// <summary>
/// The same stack with the Stage 3 tile proxy configured, which is the deployed
/// topology (<c>docker-compose.yml</c> sets <c>Tiles__ProxyBaseUrl</c>) and the only
/// one in which <c>tileMaxZoom</c> means anything.
/// </summary>
/// <remarks>
/// A separate factory rather than a setting on <see cref="RenderApiFactory"/>: every
/// test in that class shares one fixture, and turning the proxy on for all of them
/// would change the request under assertions that are about something else.
/// </remarks>
public sealed class ProxiedRenderApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder(TestContainerImages.Postgis)
        .WithDatabase("journeybook")
        .WithUsername("journeybook")
        .WithPassword("journeybook")
        .Build();

    public string GeneratedDir { get; } =
        Path.Combine(Path.GetTempPath(), $"jb-proxy-render-test-{Guid.NewGuid():N}");

    public FakeRenderWorkerClient FakeClient { get; private set; } = null!;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Postgres", _db.GetConnectionString());
        builder.UseSetting("GeneratedPdf:GeneratedDir", GeneratedDir);
        builder.UseSetting("Tiles:ProxyBaseUrl", "http://api:8080/api/tiles");
        builder.UseSetting("Tiles:DefaultSource", "usgs-topo");

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

public class ProxiedRenderApiTests(ProxiedRenderApiFactory factory)
    : IClassFixture<ProxiedRenderApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<Guid> CreateProjectAsync(string name)
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest(name, "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        var ext = await _client.PutAsJsonAsync($"/api/projects/{created!.Id}/extent",
            new BBoxDto(-96.75, 40.78, -96.65, 40.85));
        Assert.Equal(HttpStatusCode.OK, ext.StatusCode);
        return created.Id;
    }

    /// <summary>
    /// Poll until the record settles, asking <see cref="PdfStatusExtensions.IsTerminal"/>
    /// rather than restating the set.
    /// </summary>
    /// <remarks>
    /// Written here first as `r.Status is "Completed" or "Failed" or "Cancelled"` —
    /// **a seventh hand-written copy of the terminal set, added by the sweep that was
    /// hunting for exactly this**, four commits after the one that removed the other
    /// six and recorded why. That copy is how `master` went red earlier today: the
    /// poll and the record disagreed about "terminal", so a `Cancelled` record was
    /// polled for the full 30 s and reported as a timeout that had not happened.
    /// Shape 6, self-inflicted, and caught only by re-reading the diff.
    /// </remarks>
    private async Task<GeneratedPdfResponse> PollUntilTerminalAsync(Guid id)
    {
        for (var i = 0; i < 200; i++)
        {
            var r = await _client.GetFromJsonAsync<GeneratedPdfResponse>($"/api/generated-pdfs/{id}");
            if (r is not null
                && Enum.TryParse<PdfStatus>(r.Status, out var parsed)
                && parsed.IsTerminal())
            {
                return r;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException(
            $"Generated PDF {id} never reached a terminal status. Terminal is " +
            $"{string.Join(", ", Enum.GetValues<PdfStatus>().Where(s => s.IsTerminal()))}.");
    }

    /// <summary>
    /// With the proxy configured, the render carries the registered source's own
    /// <c>MaxZoom</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>RenderAtlasInput.tileMaxZoom</c>'s docstring names this exact caller as the
    /// reason the field exists — "needed when tiles come through the proxy from a
    /// registered <c>TileSource</c> whose <c>MaxZoom</c> this process cannot see" —
    /// and the API, the only component that proxies, was the one caller never
    /// sending it. The engine then applied the ceiling hardcoded for USGS Topo
    /// (<c>panel.ts</c>'s <c>maxZoom: 16</c>) to whatever source was configured, and
    /// a shallower one had every tile above its own top zoom refused by this API's
    /// own proxy with <c>ZoomOutOfRange</c>.
    /// </para>
    /// <para>
    /// The seed's 16 and the engine's 16 agreeing today is exactly why this was
    /// invisible; the assertion reads the value out of the database rather than
    /// restating it, so a re-seed at a different depth moves the expectation with it
    /// instead of pinning a fifth copy of the number.
    /// </para>
    /// </remarks>
    private async Task<RenderWorkerRequest> RenderAndCaptureAsync(string projectName)
    {
        var projectId = await CreateProjectAsync(projectName);
        var resp = await _client.PostAsJsonAsync($"/api/projects/{projectId}/render",
            new RenderProjectRequest(Tier: 1));
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<RenderProjectResponse>();
        Assert.NotNull(body);
        await PollUntilTerminalAsync(body!.GeneratedPdfId);

        Assert.True(
            factory.FakeClient.Requests.TryGetValue($"atlas-{body.GeneratedPdfId:N}.pdf", out var sent),
            $"the worker was never handed a request for atlas-{body.GeneratedPdfId:N}.pdf");
        return sent!;
    }

    private async Task SetSeededMaxZoomAsync(int value)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
        var source = await db.TileSources.SingleAsync(t => t.Key == "usgs-topo");
        source.MaxZoom = value;
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// With the proxy configured, the render carries the registered source's own
    /// <c>MaxZoom</c> — read from the registry, not restated as a constant.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>RenderAtlasInput.tileMaxZoom</c>'s docstring names this exact caller as the
    /// reason the field exists — "needed when tiles come through the proxy from a
    /// registered <c>TileSource</c> whose <c>MaxZoom</c> this process cannot see" —
    /// and the API, the only component that proxies, was the one caller never
    /// sending it. The engine then applied the ceiling hardcoded for USGS Topo
    /// (<c>panel.ts</c>'s <c>maxZoom: 16</c>) to whatever source was configured, and
    /// a shallower one had every tile above its own top zoom refused by this API's
    /// own proxy with <c>ZoomOutOfRange</c>.
    /// </para>
    /// <para>
    /// The seed's 16 and the engine's 16 agreeing today is exactly why this was
    /// invisible, and it is why the first assertion alone would be worth little: a
    /// hardcoded 16 passes it. So the row is then MOVED and the request must move
    /// with it. One test rather than two because the mutation is shared fixture
    /// state and xUnit gives no ordering between tests in a class.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task Render_through_the_proxy_carries_the_registered_sources_max_zoom()
    {
        int seeded;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>();
            seeded = await db.TileSources.Where(t => t.Key == "usgs-topo")
                .Select(t => t.MaxZoom).SingleAsync();
        }

        try
        {
            var asSeeded = await RenderAndCaptureAsync("Proxied Ceiling Project");

            // The proxy is on, so both halves of the routing must be there…
            Assert.Equal("http://api:8080/api/tiles", asSeeded.TileBaseUrl);
            Assert.Equal("usgs-topo", asSeeded.TileSourceId);
            // …and so must the ceiling the engine cannot look up for itself.
            Assert.Equal(seeded, asSeeded.TileMaxZoom);

            // Now move the registry. A ceiling restated as a constant anywhere on
            // this path — 16 in C#, or the engine's own — cannot follow it.
            var moved = seeded == 13 ? 12 : 13;
            await SetSeededMaxZoomAsync(moved);

            var afterMove = await RenderAndCaptureAsync("Proxied Shallow Ceiling Project");
            Assert.Equal(moved, afterMove.TileMaxZoom);
            Assert.NotEqual(seeded, afterMove.TileMaxZoom);
        }
        finally
        {
            await SetSeededMaxZoomAsync(seeded);
        }
    }
}

using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Rendering;
using Microsoft.Extensions.Logging.Abstractions;

namespace JourneyBook.Tests.Rendering;

/// <summary>
/// The render lifecycle, exercised without a host, a database or Docker.
/// </summary>
/// <remarks>
/// <c>PdfStatus.Rendering</c> has existed since the schema was written and nothing
/// has ever set it: the record went Pending → Completed with the whole render
/// happening inside one blocking HTTP call, so there was no moment at which anyone
/// could have observed "in progress". These tests pin the transitions a polling
/// client now depends on, in order.
/// </remarks>
public class RenderJobRunnerTests
{
    // ── Fakes ────────────────────────────────────────────────────────────────

    /// <summary>Records every status write in order; everything else throws.</summary>
    private sealed class RecordingPdfService : IGeneratedPdfService
    {
        public List<UpdateGeneratedPdfStatusRequest> Updates { get; } = [];

        public Task<GeneratedPdfResponse?> UpdateStatusAsync(
            Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default)
        {
            Updates.Add(request);
            return Task.FromResult<GeneratedPdfResponse?>(null);
        }

        public Task<GeneratedPdfResponse?> CreateAsync(Guid projectId, CreateGeneratedPdfRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<GeneratedPdfResponse>?> ListAsync(Guid projectId, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<GeneratedPdfResponse?> GetAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<int> PruneExpiredAsync(CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class StubWorkerClient(Func<RenderWorkerRequest, RenderWorkerResult> handler) : IRenderWorkerClient
    {
        public bool WasCalled { get; private set; }

        public Task<RenderWorkerResult> RenderAsync(RenderWorkerRequest request, CancellationToken ct = default)
        {
            WasCalled = true;
            return Task.FromResult(handler(request));
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static RenderWorkerRequest SampleRequest() => new(
        ScalePresetId: "usgs-7-5-min",
        Tier: 1,
        Orientation: "Portrait",
        Overlap: 0,
        Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
        Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
        Locations: [],
        OutputFileName: "atlas-test.pdf");

    private static RenderJob SampleJob() => new(Guid.NewGuid(), Guid.NewGuid(), SampleRequest());

    private static RenderJobRunner RunnerFor(IGeneratedPdfService pdfs, IRenderWorkerClient worker) =>
        new(pdfs, worker, NullLogger<RenderJobRunner>.Instance);

    // ── Tests ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Marks_the_record_Rendering_before_calling_the_worker()
    {
        var pdfs = new RecordingPdfService();
        string? statusWhenWorkerRan = null;

        var worker = new StubWorkerClient(req =>
        {
            statusWhenWorkerRan = pdfs.Updates.Count > 0 ? pdfs.Updates[^1].Status : null;
            return new RenderWorkerResult(req.OutputFileName, 3, null);
        });

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        // The point of Rendering is that it is observable WHILE the worker has the
        // job. Asserting it only at the end would pass even if it were written
        // afterwards, which would tell a poller nothing.
        Assert.Equal("Rendering", statusWhenWorkerRan);
    }

    [Fact]
    public async Task Drives_a_successful_render_Rendering_then_Completed_with_the_output_path()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 12, "USGS"));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        Assert.Equal(["Rendering", "Completed"], pdfs.Updates.Select(u => u.Status));
        Assert.Equal("atlas-test.pdf", pdfs.Updates[^1].FilePath);
        Assert.Null(pdfs.Updates[^1].ErrorMessage);
    }

    [Fact]
    public async Task Records_the_workers_diagnostic_on_the_failed_record()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(_ =>
            throw new InvalidOperationException("Render worker returned 502: tile fetch failed"));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        Assert.Equal(["Rendering", "Failed"], pdfs.Updates.Select(u => u.Status));
        // Without this the user's entire answer to a failed render is the word
        // "Failed": the POST answered 202 long before the failure, so there is no
        // response body left to carry the reason.
        Assert.Equal("Render worker returned 502: tile fetch failed", pdfs.Updates[^1].ErrorMessage);
        Assert.Null(pdfs.Updates[^1].FilePath);
    }

    [Fact]
    public async Task Does_not_rethrow_a_worker_failure()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(_ => throw new InvalidOperationException("boom"));

        // A throw here would take the background drain loop down with it and strand
        // every queued job behind this one at Pending for ever.
        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        Assert.Equal("Failed", pdfs.Updates[^1].Status);
    }

    [Fact]
    public async Task Truncates_an_enormous_diagnostic_to_the_columns_length()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(_ => throw new InvalidOperationException(new string('x', 5000)));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        Assert.Equal(2000, pdfs.Updates[^1].ErrorMessage!.Length);
    }

    [Fact]
    public async Task Marks_a_cancelled_render_Failed_rather_than_leaving_it_Rendering()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(_ => throw new OperationCanceledException());
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await RunnerFor(pdfs, worker).RunAsync(SampleJob(), cts.Token);

        // Nothing resumes an in-flight job, so a record left at Rendering is stranded
        // for the rest of its retention window.
        Assert.Equal("Failed", pdfs.Updates[^1].Status);
        Assert.Contains("cancelled", pdfs.Updates[^1].ErrorMessage, StringComparison.OrdinalIgnoreCase);
    }
}

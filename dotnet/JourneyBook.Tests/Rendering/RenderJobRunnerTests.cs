using System.Text.Json;
using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Rendering;
using Microsoft.Extensions.Logging.Abstractions;
using JourneyBook.Application.Common;

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

        /// <summary>Make the Nth status write (0-based) throw, e.g. a row deleted underneath us.</summary>
        public int? FailOnUpdate { get; set; }

        public Task<GeneratedPdfResponse?> UpdateStatusAsync(
            Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default)
        {
            if (FailOnUpdate == Updates.Count)
            {
                Updates.Add(request);
                throw new InvalidOperationException("Row vanished between accept and dequeue.");
            }
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
        /// <summary>Every progress write in order, so "it reported" can be told from "it reported once".</summary>
        public List<UpdateGeneratedPdfProgressRequest> Progress { get; } = [];

        public Task<GeneratedPdfResponse?> UpdateProgressAsync(
            Guid id, UpdateGeneratedPdfProgressRequest request, CancellationToken ct = default)
        {
            Progress.Add(request);
            return Task.FromResult<GeneratedPdfResponse?>(null);
        }

        public Task<int> PruneExpiredAsync(CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<int> FailStrandedAsync(string reason, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class StubWorkerClient(Func<RenderWorkerRequest, RenderWorkerResult> handler) : IRenderWorkerClient
    {
        public bool WasCalled { get; private set; }

        /// <summary>Progress the stub emits before answering, standing in for the worker's poll.</summary>
        public List<RenderProgressUpdate> Emits { get; } = [];

        /// <summary>The token the runner handed down, so a test can assert what it linked.</summary>
        public CancellationToken ObservedToken { get; private set; }

        public async Task<RenderWorkerResult> RenderAsync(
            RenderWorkerRequest request,
            RenderProgressHandler? onProgress = null,
            CancellationToken ct = default)
        {
            WasCalled = true;
            ObservedToken = ct;
            foreach (var emit in Emits)
            {
                if (onProgress is not null) await onProgress(emit, ct);
            }
            return handler(request);
        }
    }

    /// <summary>A registry with one pre-registered job, so a cancel has something to cancel.</summary>
    private sealed class StubCancellations : IRenderCancellationRegistry
    {
        private readonly Dictionary<Guid, CancellationTokenSource> _sources = [];

        public List<Guid> Released { get; } = [];

        public CancellationToken Register(Guid id)
        {
            if (!_sources.TryGetValue(id, out var cts)) _sources[id] = cts = new CancellationTokenSource();
            return cts.Token;
        }

        public CancellationToken TokenFor(Guid id) =>
            _sources.TryGetValue(id, out var cts) ? cts.Token : CancellationToken.None;

        public bool Cancel(Guid id)
        {
            if (!_sources.TryGetValue(id, out var cts)) return false;
            cts.Cancel();
            return true;
        }

        public void Release(Guid id) => Released.Add(id);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static RenderWorkerRequest SampleRequest() => new(
        ScalePresetId: "usgs-7-5-min",
        Tier: 1,
        Orientation: "Portrait",
        Overlap: 0,
        Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
        Extent: new BBoxDto(-96.75, 40.78, -96.65, 40.85),
        Locations: [],
        OutputFileName: "atlas-test.pdf");

    private static RenderJob SampleJob() => new(Guid.NewGuid(), Guid.NewGuid(), SampleRequest());

    private static RenderJobRunner RunnerFor(
        IGeneratedPdfService pdfs,
        IRenderWorkerClient worker,
        IRenderCancellationRegistry? cancellations = null) =>
        new(pdfs, worker, cancellations ?? new StubCancellations(), NullLogger<RenderJobRunner>.Instance);

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
    public async Task Marks_a_shut_down_render_Failed_rather_than_leaving_it_Rendering()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(_ => throw new OperationCanceledException());
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await RunnerFor(pdfs, worker).RunAsync(SampleJob(), cts.Token);

        // Nothing resumes an in-flight job, so a record left at Rendering is stranded
        // for the rest of its retention window. Failed, NOT Cancelled: nobody asked
        // for a shutdown, so the record's advice is "generate it again", not "you
        // stopped it".
        Assert.Equal("Failed", pdfs.Updates[^1].Status);
        Assert.Contains("shut down", pdfs.Updates[^1].ErrorMessage, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// <c>RenderJobProcessor</c>'s comment says "RunAsync marks the record Failed on
    /// any throw, so a job that blows up must not also take the loop down" — and calls
    /// its own catch "the belt to that braces". But the FIRST status write sat outside
    /// the try, so a throw from it (row deleted between accept and dequeue, a DB blip)
    /// escaped uncaught, was swallowed by the processor's belt, and left the row at
    /// <c>Pending</c> for ever. The comment was wrong about the exact case it was
    /// written for.
    /// </summary>
    [Fact]
    public async Task A_failure_writing_Rendering_still_leaves_the_record_Failed()
    {
        var pdfs = new RecordingPdfService { FailOnUpdate = 0 };
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 1, null));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        // Not rethrown, and not left Pending.
        Assert.Equal("Failed", pdfs.Updates[^1].Status);
        Assert.Contains("Row vanished", pdfs.Updates[^1].ErrorMessage);
        // The worker must not have been called: we never got the job into Rendering.
        Assert.False(worker.WasCalled);
    }

    [Fact]
    public async Task Reports_our_own_deadline_as_a_timeout_not_as_a_shutdown()
    {
        var pdfs = new RecordingPdfService();
        // What HttpClient.Timeout throws: a TaskCanceledException wrapping a
        // TimeoutException, with nobody's cancellation token cancelled.
        var worker = new StubWorkerClient(_ => throw new TaskCanceledException(
            "The request was canceled due to the configured HttpClient.Timeout of 120 seconds elapsing.",
            new TimeoutException()));

        // Note the *uncancelled* token: the host is healthy, the job was not aborted.
        await RunnerFor(pdfs, worker).RunAsync(SampleJob(), CancellationToken.None);

        Assert.Equal("Failed", pdfs.Updates[^1].Status);
        var message = pdfs.Updates[^1].ErrorMessage!;
        Assert.Contains("timed out", message, StringComparison.OrdinalIgnoreCase);
        // "the service shut down or the job was aborted" is the sentence the user got
        // for the API's own two-minute cap. Neither half of it was true.
        Assert.DoesNotContain("shut down", message, StringComparison.OrdinalIgnoreCase);
    }

    // ── Progress (ADR 0007) ──────────────────────────────────────────────────

    [Fact]
    public async Task Writes_every_position_the_worker_reports_onto_the_record()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 3, null))
        {
            Emits =
            {
                new RenderProgressUpdate(0, 3, "contract"),
                new RenderProgressUpdate(1, 3, "panel"),
                new RenderProgressUpdate(2, 3, "panel"),
                new RenderProgressUpdate(3, 3, "panel"),
            },
        };

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        // The half-wired trap: the worker can report all it likes and the record is
        // the only thing a polling client reads. Every hop has to be proven to
        // arrive, and this is the last one before the wire.
        Assert.Equal([0, 1, 2, 3], pdfs.Progress.Select(p => p.Progress));
        Assert.All(pdfs.Progress, p => Assert.Equal(3, p.PageCount));
        Assert.Equal(["Rendering", "Completed"], pdfs.Updates.Select(u => u.Status));

        // The phase, which this test SUPPLIED above and never looked at — the
        // overlap bug's exact shape, one field along. `RenderProgressUpdate.Phase`
        // is documented at length in `IRenderWorkerClient` ("carried verbatim
        // rather than re-interpreted"), reached this class from the engine through
        // four hops, and then `UpdateGeneratedPdfProgressRequest` had no member for
        // it, so the only reader in the repo was `HttpRenderWorkerClientTests`.
        Assert.Equal(["contract", "panel", "panel", "panel"], pdfs.Progress.Select(p => p.Phase));
    }

    /// <summary>
    /// The phase reaches the record for the two positions the page counter cannot
    /// describe.
    /// </summary>
    /// <remarks>
    /// Not a repeat of the assertion above. <c>Progress</c> counts finished basemap
    /// PANELS, so at phase <c>pdf</c> it already equals <c>PageCount</c> — a client
    /// reading only the numbers draws a full bar for the whole of PDF assembly — and
    /// at <c>contract</c> there is no denominator at all. Those are the two reports
    /// whose numbers are indistinguishable from a stall, and the phase is the only
    /// thing that separates them.
    /// </remarks>
    // ── Provenance on the finished record ────────────────────────────────────

    /// <summary>
    /// The credit the PDF actually printed lands on the record.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>RenderWorkerResult.Attribution</c> is the engine's collected credit —
    /// "the credit the PDF actually printed, not a guess from the input flags", in
    /// its own words — carried over the job protocol, deserialized into
    /// <c>WorkerJob.Attribution</c>, and assigned into <c>RenderWorkerResult</c>
    /// at <c>HttpRenderWorkerClient</c>. A repo-wide search for a reader of that
    /// property found the constructor call and nothing else. Written and never
    /// read, on the field a licensing requirement leans on.
    /// </para>
    /// <para>
    /// Its other half: <c>GeneratedPdf.SourceMetadataSnapshot</c> is declared as
    /// "a snapshot of the source metadata (tile sources, attribution, scale)
    /// captured at render time" and the render path created every record with an
    /// empty one. A value with no reader and a field with no writer, and each was
    /// the other's answer.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task The_finished_record_carries_the_attribution_the_PDF_actually_printed()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(
            req => new RenderWorkerResult(req.OutputFileName, 7, "USGS The National Map · OpenStreetMap"));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        var completed = Assert.Single(pdfs.Updates.Where(u => u.Status == "Completed"));
        Assert.NotNull(completed.SourceMetadataSnapshot);

        using var doc = JsonDocument.Parse(completed.SourceMetadataSnapshot!);
        Assert.Equal(
            "USGS The National Map · OpenStreetMap",
            doc.RootElement.GetProperty("attribution").GetString());
        // The request's own parameters too — the rest of what "source metadata at
        // render time" names.
        Assert.Equal("usgs-7-5-min", doc.RootElement.GetProperty("scalePresetId").GetString());
        Assert.Equal(1, doc.RootElement.GetProperty("tier").GetInt32());
    }

    /// <summary>
    /// The page count from the finished render reaches the record even when no
    /// progress report did.
    /// </summary>
    /// <remarks>
    /// <c>PageCount</c> only ever arrived through <c>UpdateProgressAsync</c>, and
    /// the client emits a progress report only when it observes one between two
    /// polls. A render that finishes inside one poll interval — a small line-art
    /// atlas, or anything with a warm tile cache — reached <c>Completed</c> with a
    /// null page count, so the record could not say how many pages the PDF it
    /// points at has. `Emits` is deliberately empty here.
    /// </remarks>
    [Fact]
    public async Task A_render_that_reported_no_progress_still_records_its_page_count()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 7, null));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        Assert.Empty(pdfs.Progress);
        var completed = Assert.Single(pdfs.Updates.Where(u => u.Status == "Completed"));
        Assert.Equal(7, completed.PageCount);
    }

    /// <summary>
    /// A jsonb column and a quote character. The attribution is a free string from
    /// another process and several real provider credits contain quotes; string
    /// concatenation would build something Postgres refuses and fail a render that
    /// had already succeeded.
    /// </summary>
    [Fact]
    public async Task A_quoted_attribution_still_produces_valid_JSON()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(
            req => new RenderWorkerResult(req.OutputFileName, 1, "The \"National\" Map \\ tiles"));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        var completed = Assert.Single(pdfs.Updates.Where(u => u.Status == "Completed"));
        using var doc = JsonDocument.Parse(completed.SourceMetadataSnapshot!);
        Assert.Equal("The \"National\" Map \\ tiles", doc.RootElement.GetProperty("attribution").GetString());
    }

    [Fact]
    public async Task The_phase_arrives_for_the_positions_the_numbers_cannot_describe()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 2, null))
        {
            Emits =
            {
                new RenderProgressUpdate(0, 0, "contract"),
                new RenderProgressUpdate(2, 2, "panel"),
                new RenderProgressUpdate(2, 2, "pdf"),
            },
        };

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        var pdfPhase = Assert.Single(pdfs.Progress.Where(p => p.Phase == "pdf"));
        // Same two numbers as the last panel report; only the phase differs.
        Assert.Equal(2, pdfPhase.Progress);
        Assert.Equal(2, pdfPhase.PageCount);

        var contract = Assert.Single(pdfs.Progress.Where(p => p.Phase == "contract"));
        Assert.Equal(0, contract.PageCount);
    }

    [Fact]
    public async Task A_render_that_reports_nothing_still_completes()
    {
        // CONTROL, must be accepted. Progress is optional on the interface, and a
        // worker that never reports one must not be a render that never finishes.
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 1, null));

        await RunnerFor(pdfs, worker).RunAsync(SampleJob());

        Assert.Empty(pdfs.Progress);
        Assert.Equal("Completed", pdfs.Updates[^1].Status);
    }

    // ── Cancel (ADR 0007) ────────────────────────────────────────────────────

    [Fact]
    public async Task A_job_cancelled_while_queued_is_marked_Cancelled_and_never_reaches_the_worker()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 1, null));
        var cancellations = new StubCancellations();
        var job = SampleJob();
        cancellations.Register(job.GeneratedPdfId);
        cancellations.Cancel(job.GeneratedPdfId);

        await RunnerFor(pdfs, worker, cancellations).RunAsync(job);

        Assert.Equal(["Cancelled"], pdfs.Updates.Select(u => u.Status));
        // Not merely "it ended": it must not have started. Rendering an atlas the
        // user has already withdrawn burns the same minutes of tile fetching and
        // produces a PDF nothing points at.
        Assert.False(worker.WasCalled);
        // And it must never have said Rendering, which would have shown a polling
        // client a render starting after they cancelled it.
        Assert.DoesNotContain("Rendering", pdfs.Updates.Select(u => u.Status));
    }

    [Fact]
    public async Task A_worker_cancelled_render_is_Cancelled_not_Failed()
    {
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(_ =>
            throw new RenderCancelledException("Render was cancelled after 4 of 12 pages."));
        var cancellations = new StubCancellations();
        var job = SampleJob();
        cancellations.Register(job.GeneratedPdfId);

        await RunnerFor(pdfs, worker, cancellations).RunAsync(job);

        Assert.Equal(["Rendering", "Cancelled"], pdfs.Updates.Select(u => u.Status));
        // The worker's own words, including how far it got. A cancel reported as a
        // failure sends someone looking for a diagnostic that does not exist.
        Assert.Equal("Render was cancelled after 4 of 12 pages.", pdfs.Updates[^1].ErrorMessage);
        Assert.Null(pdfs.Updates[^1].FilePath);
    }

    [Fact]
    public async Task A_users_cancel_is_told_apart_from_a_host_shutdown()
    {
        // Both cancel the SAME linked token, which is why this needs a test: the
        // only thing separating them is which source was cancelled, and getting it
        // wrong tells a user who pressed Cancel that the service restarted.
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(_ => throw new OperationCanceledException());
        var cancellations = new StubCancellations();
        var job = SampleJob();
        cancellations.Register(job.GeneratedPdfId);
        cancellations.Cancel(job.GeneratedPdfId);

        // Host token healthy; only the user's is cancelled. The queued-cancel branch
        // is skipped by giving the runner a job whose token cancels mid-flight is
        // awkward to stage, so this exercises the classifier directly through the
        // worker throw.
        await RunnerFor(pdfs, worker, cancellations).RunAsync(job, CancellationToken.None);

        Assert.Equal("Cancelled", pdfs.Updates[^1].Status);
        Assert.DoesNotContain("shut down", pdfs.Updates[^1].ErrorMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Hands_the_worker_a_token_that_the_users_cancel_can_reach()
    {
        // The half-wired trap again, on the cancel path: a registry that is never
        // linked into the render is a Cancel button that marks a row and leaves the
        // worker rendering. Assert the token the runner passed down is genuinely
        // cancellable by the registry.
        var pdfs = new RecordingPdfService();
        var worker = new StubWorkerClient(req => new RenderWorkerResult(req.OutputFileName, 1, null));
        var cancellations = new StubCancellations();
        var job = SampleJob();
        cancellations.Register(job.GeneratedPdfId);

        await RunnerFor(pdfs, worker, cancellations).RunAsync(job);

        Assert.True(worker.ObservedToken.CanBeCanceled);
        Assert.False(worker.ObservedToken.IsCancellationRequested);
        // And the registry entry is handed back when the job is over, so it is not a
        // handle on a render that has finished.
        Assert.Contains(job.GeneratedPdfId, cancellations.Released);
    }
}

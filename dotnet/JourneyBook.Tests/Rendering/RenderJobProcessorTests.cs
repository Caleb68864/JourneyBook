using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using JourneyBook.Application.Common;

namespace JourneyBook.Tests.Rendering;

/// <summary>
/// What the background drain loop does when the host stops.
/// </summary>
/// <remarks>
/// ADR 0006 says "a cancelled or shut-down render is marked <c>Failed</c>". That was
/// true of at most ONE row per shutdown — the job in flight. Every job still sitting
/// in the channel was discarded silently: <c>DequeueAllAsync(stoppingToken)</c> throws
/// <c>OperationCanceledException</c>, which the loop caught and ignored, so a user who
/// queued three atlases and restarted the API was left with two rows stuck at
/// <c>Pending</c>, no explanation, and a client that polls them for fifteen minutes.
/// </remarks>
public class RenderJobProcessorTests
{
    private sealed class RecordingPdfService : IGeneratedPdfService
    {
        public List<(Guid Id, UpdateGeneratedPdfStatusRequest Request)> Updates { get; } = [];

        /// <summary>Reasons passed to <c>FailStrandedAsync</c>, in call order.</summary>
        public List<string> StrandedSweeps { get; } = [];

        /// <summary>How many rows the next sweep should claim to have reconciled.</summary>
        public int StrandedRows { get; set; }

        /// <summary>Signals the first startup reconciliation, so a test need not sleep.</summary>
        public TaskCompletionSource Reconciled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<GeneratedPdfResponse?> UpdateStatusAsync(
            Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default)
        {
            lock (Updates) Updates.Add((id, request));
            return Task.FromResult<GeneratedPdfResponse?>(null);
        }

        public Task<int> FailStrandedAsync(string reason, CancellationToken ct = default)
        {
            lock (StrandedSweeps) StrandedSweeps.Add(reason);
            Reconciled.TrySetResult();
            return Task.FromResult(StrandedRows);
        }

        public Task<GeneratedPdfResponse?> CreateAsync(Guid projectId, CreateGeneratedPdfRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<GeneratedPdfResponse>?> ListAsync(Guid projectId, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<GeneratedPdfResponse?> GetAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<GeneratedPdfResponse?> UpdateProgressAsync(Guid id, UpdateGeneratedPdfProgressRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<int> PruneExpiredAsync(CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    /// <summary>Blocks on the first job until released, so the rest stay queued.</summary>
    private sealed class BlockingRunner(RecordingPdfService pdfs) : IRenderJobRunner
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public List<Guid> Ran { get; } = [];

        /// <summary>Sweeps already recorded when the first job reached the runner.</summary>
        public int SweepsBeforeFirstJob { get; private set; } = -1;

        public async Task RunAsync(RenderJob job, CancellationToken ct = default)
        {
            lock (Ran)
            {
                if (Ran.Count == 0)
                {
                    lock (pdfs.StrandedSweeps) SweepsBeforeFirstJob = pdfs.StrandedSweeps.Count;
                }

                Ran.Add(job.GeneratedPdfId);
            }

            await pdfs.UpdateStatusAsync(job.GeneratedPdfId, new UpdateGeneratedPdfStatusRequest("Rendering"), ct);
            Started.TrySetResult();
            await Release.Task.WaitAsync(ct);
        }
    }

    private static RenderJob JobFor(Guid id) => new(
        id,
        Guid.NewGuid(),
        new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 1, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new BBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: $"atlas-{id}.pdf"));

    [Fact]
    public async Task Marks_every_still_queued_job_Failed_when_the_host_stops()
    {
        var pdfs = new RecordingPdfService();
        var runner = new BlockingRunner(pdfs);

        var services = new ServiceCollection();
        services.AddSingleton<IGeneratedPdfService>(pdfs);
        services.AddSingleton<IRenderJobRunner>(runner);
        using var provider = services.BuildServiceProvider();

        var queue = new ChannelRenderJobQueue();
        var processor = new RenderJobProcessor(
            queue,
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RenderJobProcessor>.Instance);

        var inFlight = Guid.NewGuid();
        var queued1 = Guid.NewGuid();
        var queued2 = Guid.NewGuid();
        await queue.EnqueueAsync(JobFor(inFlight));
        await queue.EnqueueAsync(JobFor(queued1));
        await queue.EnqueueAsync(JobFor(queued2));

        await processor.StartAsync(CancellationToken.None);
        await runner.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        // Shutdown. The in-flight job's own cancellation is the runner's business
        // (RenderJobRunnerTests covers it); here the runner is a stub that simply
        // observes the stopping token, so what this asserts is what happens to the
        // two jobs that never started.
        await processor.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        // Only the first job ever reached the runner.
        Assert.Equal([inFlight], runner.Ran);

        var failed = pdfs.Updates
            .Where(u => u.Request.Status == "Failed")
            .ToDictionary(u => u.Id, u => u.Request);

        Assert.True(failed.ContainsKey(queued1), "queued job 1 was dropped silently");
        Assert.True(failed.ContainsKey(queued2), "queued job 2 was dropped silently");
        Assert.Contains("shut down", failed[queued1].ErrorMessage, StringComparison.OrdinalIgnoreCase);
        // The queue is in-process: nothing resumes these, so the record must say so
        // rather than sit at Pending while the client polls it 900 times.
        Assert.Null(failed[queued1].FilePath);
    }

    [Fact]
    public async Task A_clean_shutdown_with_an_empty_queue_writes_nothing()
    {
        var pdfs = new RecordingPdfService();
        var runner = new BlockingRunner(pdfs);

        var services = new ServiceCollection();
        services.AddSingleton<IGeneratedPdfService>(pdfs);
        services.AddSingleton<IRenderJobRunner>(runner);
        using var provider = services.BuildServiceProvider();

        var processor = new RenderJobProcessor(
            new ChannelRenderJobQueue(),
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RenderJobProcessor>.Instance);

        await processor.StartAsync(CancellationToken.None);
        await processor.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Empty(pdfs.Updates);
    }

    /// <summary>
    /// Startup reconciliation: the half of the strand that a shutdown path cannot cover.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>FailQueuedJobsAsync</c> closes the orderly-<c>SIGTERM</c> case. A
    /// <c>SIGKILL</c>, an OOM kill, a container crash or power loss runs no shutdown
    /// path at all, and the retention sweep does not help despite its comment once
    /// claiming it did: <c>PruneExpiredAsync</c> is
    /// <c>Where(ExpiresAt != null &amp;&amp; ExpiresAt &lt; now)</c> — rows past their
    /// 30-day window — and a row stranded ten seconds ago by a crash is not expired.
    /// A repo-wide grep for startup reconciliation of Pending/Rendering rows returned
    /// nothing, and the whole .NET suite was green: the strand was fixed only for a
    /// graceful shutdown, and after a crash the row sat at Pending for 30 days while
    /// the client polled it 900 times and then said "The render is still running".
    /// </para>
    /// <para>
    /// The reconciliation must happen BEFORE the first job is dequeued, or a job that
    /// starts quickly is itself marked Failed by the sweep meant to clear its
    /// predecessors — so the ordering is asserted, not just the call.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task Fails_rows_a_previous_process_left_behind_before_running_anything()
    {
        var pdfs = new RecordingPdfService { StrandedRows = 2 };
        var runner = new BlockingRunner(pdfs);

        var services = new ServiceCollection();
        services.AddSingleton<IGeneratedPdfService>(pdfs);
        services.AddSingleton<IRenderJobRunner>(runner);
        using var provider = services.BuildServiceProvider();

        var queue = new ChannelRenderJobQueue();
        var processor = new RenderJobProcessor(
            queue,
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RenderJobProcessor>.Instance);

        // A job already waiting when the host comes up, exactly as after a restart
        // where the client retried.
        var fresh = Guid.NewGuid();
        await queue.EnqueueAsync(JobFor(fresh));

        await processor.StartAsync(CancellationToken.None);
        await pdfs.Reconciled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await runner.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        // The fixture reached the subject: the queue really was drained, so the
        // assertions below are about a processor that actually ran.
        Assert.Equal([fresh], runner.Ran);

        var sweep = Assert.Single(pdfs.StrandedSweeps);
        Assert.Equal(RenderJobProcessor.StrandedByRestartMessage, sweep);
        Assert.Contains("restarted", sweep, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Generate the atlas again", sweep, StringComparison.Ordinal);

        // Before the first job, not after it.
        Assert.Equal(1, runner.SweepsBeforeFirstJob);

        // And the sweep does not touch the job this host is running: the row for
        // `fresh` is moved by the runner, never by the reconciliation.
        Assert.DoesNotContain(pdfs.Updates, u => u.Id == fresh && u.Request.Status == "Failed");

        runner.Release.TrySetResult();
        await processor.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
    }

    /// <summary>
    /// A reconciliation that cannot reach the database must not stop the host: the
    /// rows it would have cleared belong to a previous process, and this one is being
    /// started to serve new renders.
    /// </summary>
    [Fact]
    public async Task A_reconciliation_that_throws_does_not_stop_the_processor()
    {
        var pdfs = new ThrowingReconcilePdfService();
        var runner = new BlockingRunner(new RecordingPdfService());

        var services = new ServiceCollection();
        services.AddSingleton<IGeneratedPdfService>(pdfs);
        services.AddSingleton<IRenderJobRunner>(runner);
        using var provider = services.BuildServiceProvider();

        var queue = new ChannelRenderJobQueue();
        var processor = new RenderJobProcessor(
            queue,
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RenderJobProcessor>.Instance);

        await queue.EnqueueAsync(JobFor(Guid.NewGuid()));
        await processor.StartAsync(CancellationToken.None);

        // The job still runs.
        await runner.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(pdfs.Attempted, "reconciliation was never attempted");

        runner.Release.TrySetResult();
        await processor.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
    }

    private sealed class ThrowingReconcilePdfService : IGeneratedPdfService
    {
        public bool Attempted { get; private set; }

        public Task<int> FailStrandedAsync(string reason, CancellationToken ct = default)
        {
            Attempted = true;
            throw new InvalidOperationException("database is not up yet");
        }

        public Task<GeneratedPdfResponse?> UpdateStatusAsync(Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default)
            => Task.FromResult<GeneratedPdfResponse?>(null);
        public Task<GeneratedPdfResponse?> CreateAsync(Guid projectId, CreateGeneratedPdfRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<GeneratedPdfResponse>?> ListAsync(Guid projectId, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<GeneratedPdfResponse?> GetAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<GeneratedPdfResponse?> UpdateProgressAsync(Guid id, UpdateGeneratedPdfProgressRequest request, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<int> PruneExpiredAsync(CancellationToken ct = default)
            => throw new NotSupportedException();
    }
}

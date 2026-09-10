using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

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

        public Task<GeneratedPdfResponse?> UpdateStatusAsync(
            Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default)
        {
            lock (Updates) Updates.Add((id, request));
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

    /// <summary>Blocks on the first job until released, so the rest stay queued.</summary>
    private sealed class BlockingRunner(IGeneratedPdfService pdfs) : IRenderJobRunner
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public List<Guid> Ran { get; } = [];

        public async Task RunAsync(RenderJob job, CancellationToken ct = default)
        {
            lock (Ran) Ran.Add(job.GeneratedPdfId);
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
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
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
}

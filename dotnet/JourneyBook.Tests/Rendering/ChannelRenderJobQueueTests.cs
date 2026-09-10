using System.Threading.Channels;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Rendering;

namespace JourneyBook.Tests.Rendering;

/// <summary>
/// The hand-off between the request that answers 202 and the loop that renders.
/// </summary>
public class ChannelRenderJobQueueTests
{
    private static RenderJob JobNamed(string outputFileName) => new(
        Guid.NewGuid(),
        Guid.NewGuid(),
        new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min",
            Tier: 1,
            Orientation: "Portrait",
            Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [],
            OutputFileName: outputFileName));

    [Fact]
    public async Task Enqueue_returns_without_waiting_for_a_consumer()
    {
        var queue = new ChannelRenderJobQueue();

        // The whole point of the 202 is that the POST does not block. An enqueue that
        // waited for a reader would move the wait rather than remove it.
        await queue.EnqueueAsync(JobNamed("a.pdf")).AsTask().WaitAsync(TimeSpan.FromSeconds(2));
    }

    [Fact]
    public async Task Delivers_queued_jobs_in_order()
    {
        var queue = new ChannelRenderJobQueue();
        await queue.EnqueueAsync(JobNamed("first.pdf"));
        await queue.EnqueueAsync(JobNamed("second.pdf"));
        await queue.EnqueueAsync(JobNamed("third.pdf"));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var seen = new List<string>();
        await foreach (var job in queue.DequeueAllAsync(cts.Token))
        {
            seen.Add(job.WorkerRequest.OutputFileName);
            if (seen.Count == 3) break;
        }

        Assert.Equal(["first.pdf", "second.pdf", "third.pdf"], seen);
    }

    [Fact]
    public async Task Dequeue_waits_for_a_job_enqueued_after_the_drain_started()
    {
        var queue = new ChannelRenderJobQueue();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        var drain = Task.Run(async () =>
        {
            await foreach (var job in queue.DequeueAllAsync(cts.Token))
                return job.WorkerRequest.OutputFileName;
            return null;
        }, cts.Token);

        await queue.EnqueueAsync(JobNamed("late.pdf"));

        Assert.Equal("late.pdf", await drain);
    }

    [Fact]
    public async Task DrainPending_hands_back_everything_still_queued_in_order()
    {
        var queue = new ChannelRenderJobQueue();
        await queue.EnqueueAsync(JobNamed("first.pdf"));
        await queue.EnqueueAsync(JobNamed("second.pdf"));

        var stranded = queue.DrainPending();

        Assert.Equal(["first.pdf", "second.pdf"], stranded.Select(j => j.WorkerRequest.OutputFileName));
        // Idempotent: a second drain finds nothing left to strand.
        Assert.Empty(queue.DrainPending());
    }

    [Fact]
    public async Task DrainPending_closes_the_queue_so_nothing_slips_in_behind_it()
    {
        var queue = new ChannelRenderJobQueue();
        queue.DrainPending();

        // A request racing shutdown must not be able to enqueue a job that would then
        // never run and never be marked Failed. Refusing it surfaces as a failed
        // accept, which is truthful.
        await Assert.ThrowsAsync<ChannelClosedException>(
            async () => await queue.EnqueueAsync(JobNamed("too-late.pdf")));
    }

    [Fact]
    public async Task Dequeue_ends_when_the_host_stops()
    {
        var queue = new ChannelRenderJobQueue();
        using var cts = new CancellationTokenSource();

        var drain = Task.Run(async () =>
        {
            await foreach (var _ in queue.DequeueAllAsync(cts.Token)) { }
        }, CancellationToken.None);

        await cts.CancelAsync();

        // A drain that ignored the stopping token would hold shutdown open.
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => drain.WaitAsync(TimeSpan.FromSeconds(5)));
    }
}

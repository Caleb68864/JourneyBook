using System.Threading.Channels;
using JourneyBook.Application.Rendering;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// In-process render queue backed by an unbounded <see cref="Channel{T}"/>.
/// </summary>
/// <remarks>
/// <para>
/// In-process is a deliberate limit, not an oversight. Queued jobs live in this
/// process's memory: restart the API with work outstanding and those records sit at
/// <c>Pending</c> or <c>Rendering</c> for ever, because nothing survives to pick them
/// up. That is acceptable for a single-instance deployment (which is what the Compose
/// file describes) and is not acceptable for more than one API replica, where two
/// instances would each drain their own queue and neither would see the other's work.
/// A durable queue — or, better, moving job ownership into the render-worker, which is
/// the only process that knows how far along a render is — is the next step. Until
/// then the failure mode is recorded here rather than discovered.
/// </para>
/// <para>
/// Registered as a singleton: the request that accepts a render and the background
/// loop that performs it must share one channel.
/// </para>
/// </remarks>
public sealed class ChannelRenderJobQueue : IRenderJobQueue
{
    private readonly Channel<RenderJob> _channel =
        Channel.CreateUnbounded<RenderJob>(new UnboundedChannelOptions
        {
            // One consumer (the hosted loop); many producers (request threads).
            SingleReader = true,
            SingleWriter = false,
        });

    public ValueTask EnqueueAsync(RenderJob job, CancellationToken ct = default) =>
        _channel.Writer.WriteAsync(job, ct);

    public IAsyncEnumerable<RenderJob> DequeueAllAsync(CancellationToken ct) =>
        _channel.Reader.ReadAllAsync(ct);

    public IReadOnlyList<RenderJob> DrainPending()
    {
        // Complete the writer first so a request racing shutdown cannot slip a job in
        // behind the drain and have it stranded anyway. EnqueueAsync then throws
        // ChannelClosedException, which the accepting request surfaces as a failure —
        // truthful, because the render was never going to happen.
        _channel.Writer.TryComplete();

        var remaining = new List<RenderJob>();
        while (_channel.Reader.TryRead(out var job)) remaining.Add(job);
        return remaining;
    }
}

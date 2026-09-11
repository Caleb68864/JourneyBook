namespace JourneyBook.Application.Rendering;

/// <summary>
/// A render that has been accepted and persisted but not yet performed.
/// </summary>
/// <remarks>
/// The job carries the <em>already-built</em> <see cref="RenderWorkerRequest"/> rather
/// than a project id, deliberately. Everything that reads the database — resolving the
/// project graph, its extent, locations and landmarks — happens on the request thread,
/// inside the request's scope, before the 202 is returned. The background worker
/// therefore needs no <c>DbContext</c> read of its own and cannot observe a project
/// that was edited between the click and the render: the atlas that comes out is the
/// atlas the user asked for at the moment they asked for it.
/// </remarks>
public record RenderJob(Guid GeneratedPdfId, Guid ProjectId, RenderWorkerRequest WorkerRequest);

/// <summary>
/// The hand-off between the HTTP request that accepts a render (202) and the
/// background loop that performs it.
/// </summary>
public interface IRenderJobQueue
{
    /// <summary>Queue a job for the background renderer.</summary>
    ValueTask EnqueueAsync(RenderJob job, CancellationToken ct = default);

    /// <summary>
    /// Yield queued jobs as they arrive, completing only when <paramref name="ct"/>
    /// is cancelled (host shutdown).
    /// </summary>
    IAsyncEnumerable<RenderJob> DequeueAllAsync(CancellationToken ct);

    /// <summary>
    /// Close the queue to new work and take everything still in it, without waiting.
    /// </summary>
    /// <remarks>
    /// For shutdown only. The queue is in-process, so a job still sitting in it when
    /// the host stops is never coming back — nothing resumes it and nothing else can
    /// see it. Discarding those silently (which is what happened, because
    /// <see cref="DequeueAllAsync"/> simply throws <c>OperationCanceledException</c>)
    /// left their records at <c>Pending</c> for ever, with a client politely polling
    /// each one for fifteen minutes. Marking them <c>Failed</c> is not a nicety: it
    /// is the only signal those rows will ever get.
    /// </remarks>
    IReadOnlyList<RenderJob> DrainPending();
}

/// <summary>
/// One cancellation token per accepted render, keyed by its <c>GeneratedPdf</c> id.
/// </summary>
/// <remarks>
/// <para>
/// A render is cancellable from the moment it is accepted, which is before anything
/// is running: the job may be waiting in the queue, or the worker may already have
/// it. One token covers both — the processor refuses to start a job whose token is
/// already cancelled, and <c>HttpRenderWorkerClient</c> turns the same token into a
/// <c>DELETE /jobs/{id}</c> on the worker.
/// </para>
/// <para>
/// In memory, and a singleton, for the same reason the queue is (ADR 0006): a token
/// is a handle on work happening in this process. Persisting it would let a
/// restarted host "cancel" a render that is not happening, which is a worse answer
/// than saying it is not running here.
/// </para>
/// </remarks>
public interface IRenderCancellationRegistry
{
    /// <summary>Register a token for a newly accepted render and return it.</summary>
    CancellationToken Register(Guid generatedPdfId);

    /// <summary>
    /// The token for a registered render, or <see cref="CancellationToken.None"/>
    /// when this process has no job for it.
    /// </summary>
    CancellationToken TokenFor(Guid generatedPdfId);

    /// <summary>
    /// Cancel a registered render. Returns false when this process has no job for
    /// it — which is a real answer, not a failure to try.
    /// </summary>
    bool Cancel(Guid generatedPdfId);

    /// <summary>Drop a finished render's token. Safe to call more than once.</summary>
    void Release(Guid generatedPdfId);
}

/// <summary>
/// Performs one queued render: marks the lifecycle record <c>Rendering</c>, invokes the
/// render worker, then marks it <c>Completed</c>, <c>Failed</c> or <c>Cancelled</c>.
/// </summary>
/// <remarks>
/// Split out from the hosted background loop that drives it so the state machine
/// is testable without a host, a database or a Docker daemon.
/// </remarks>
public interface IRenderJobRunner
{
    Task RunAsync(RenderJob job, CancellationToken ct = default);
}

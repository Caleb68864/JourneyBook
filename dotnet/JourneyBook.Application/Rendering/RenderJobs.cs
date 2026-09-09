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
}

/// <summary>
/// Performs one queued render: marks the lifecycle record <c>Rendering</c>, invokes the
/// render worker, then marks it <c>Completed</c> or <c>Failed</c>.
/// </summary>
/// <remarks>
/// Split out from the hosted background loop that drives it so the state machine
/// is testable without a host, a database or a Docker daemon.
/// </remarks>
public interface IRenderJobRunner
{
    Task RunAsync(RenderJob job, CancellationToken ct = default);
}

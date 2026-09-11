namespace JourneyBook.Application.Rendering;

/// <summary>
/// How far a render has got, as the worker reports it.
/// </summary>
/// <param name="Page">Pages whose basemap panel has finished.</param>
/// <param name="PageCount">Pages in the assembled contract; 0 until the engine has derived them.</param>
/// <param name="Phase">
/// The engine's own phase name (<c>contract</c>, <c>panel</c>, <c>overview</c>,
/// <c>pdf</c>, <c>done</c>), carried verbatim rather than re-interpreted. The API
/// owns no rendering (ADR 0005) and that includes not inventing its own vocabulary
/// for what the renderer is doing.
/// </param>
public record RenderProgressUpdate(int Page, int PageCount, string Phase);

/// <summary>
/// Called by <see cref="IRenderWorkerClient"/> each time the worker reports a
/// different position, and <b>awaited</b> before the next poll.
/// </summary>
/// <remarks>
/// A <c>Func</c> returning a <c>Task</c> rather than <see cref="IProgress{T}"/>
/// on purpose. The handler writes to the database; <c>IProgress.Report</c> is
/// <c>void</c>, so every write would be a fire-and-forget continuation racing the
/// next one and, at the end, racing the <c>Completed</c> write — a progress value
/// landing after the terminal status is a row that says "rendering page 12" and
/// "Completed" at once. Awaiting it inside the poll loop makes the writes ordered
/// and bounded by the poll interval.
/// </remarks>
public delegate Task RenderProgressHandler(RenderProgressUpdate update, CancellationToken ct);

/// <summary>
/// Abstraction over the Node render-worker HTTP service. The real implementation
/// (<c>HttpRenderWorkerClient</c>) is a typed <c>HttpClient</c>; integration tests
/// inject a stub so no live worker process is required.
/// </summary>
public interface IRenderWorkerClient
{
    /// <summary>
    /// Run one render to completion: accept a job on the worker, follow it, and
    /// return its result.
    /// </summary>
    /// <remarks>
    /// Since ADR 0007 this is a job, not a request: the worker answers 202 with an
    /// id and the implementation polls. Cancelling <paramref name="ct"/> must
    /// therefore reach the worker — abandoning the HTTP call would leave the render
    /// running, produce a PDF nothing points at, and keep fetching tiles for it.
    /// </remarks>
    Task<RenderWorkerResult> RenderAsync(
        RenderWorkerRequest request,
        RenderProgressHandler? onProgress = null,
        CancellationToken ct = default);
}

/// <summary>
/// The worker stopped a render because it was asked to (ADR 0007's
/// <c>DELETE /jobs/{id}</c>, or this host's own shutdown reaching the worker).
/// </summary>
/// <remarks>
/// Distinct from every other failure because it is not one: nothing broke, and the
/// record it produces is <c>Cancelled</c>, not <c>Failed</c>. Before this existed
/// the only channel was <c>OperationCanceledException</c>, which an
/// <c>HttpClient</c> deadline also throws — which is how a worker timeout came to
/// be reported to users as a cancellation.
/// </remarks>
public sealed class RenderCancelledException(string message) : Exception(message);

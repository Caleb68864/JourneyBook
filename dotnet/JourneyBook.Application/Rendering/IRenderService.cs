namespace JourneyBook.Application.Rendering;

/// <summary>
/// Accepts a render: creates the lifecycle record and queues the work. It does
/// not perform the render — <c>RenderJobRunner</c> does, off the request thread
/// (ADR 0006).
/// </summary>
public interface IRenderService
{
    /// <summary>
    /// Accept a render for the given project.
    /// <list type="bullet">
    ///   <item><term><see cref="RenderOutcome.ProjectNotFound"/></term><description>project id is unknown (→ 404)</description></item>
    ///   <item><term><see cref="RenderOutcome.InvalidParameters"/></term><description>tier or panel knobs out of range, or nothing to render (→ 400)</description></item>
    ///   <item><term><see cref="RenderOutcome.Accepted"/></term><description>record created and queued (→ 202)</description></item>
    /// </list>
    /// </summary>
    /// <remarks>
    /// This list used to name <c>WorkerFailed</c> (→ 502) and <c>Success</c> (→ 200),
    /// neither of which has existed since the POST stopped performing the render.
    /// A worker failure is not an outcome of the request that started it: it lands
    /// on the record as <c>Failed</c> with an <c>ErrorMessage</c>, and the polling
    /// client reads it there.
    /// </remarks>
    Task<RenderServiceResult> RenderProjectAsync(
        Guid projectId,
        RenderProjectRequest request,
        CancellationToken ct = default);

    /// <summary>
    /// Ask an accepted render to stop, by the id of its <c>GeneratedPdf</c> record.
    /// </summary>
    /// <remarks>
    /// The cancellation has to reach whatever is actually doing the work, which is
    /// either this host's queue (the job has not started) or the render worker (it
    /// has). Both are behind one token, held in <see cref="IRenderCancellationRegistry"/>
    /// for the life of the job; cancelling it stops a queued job before it starts
    /// and, for a running one, makes <c>HttpRenderWorkerClient</c> send the worker a
    /// <c>DELETE /jobs/{id}</c>. Cancelling only the API's own wait would leave the
    /// worker rendering.
    /// </remarks>
    Task<CancelRenderResult> CancelRenderAsync(Guid generatedPdfId, CancellationToken ct = default);
}

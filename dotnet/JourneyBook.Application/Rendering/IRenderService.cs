namespace JourneyBook.Application.Rendering;

/// <summary>
/// Orchestrates a full render: creates the lifecycle record, invokes the
/// render worker, and marks the record <c>Completed</c> or <c>Failed</c>.
/// </summary>
public interface IRenderService
{
    /// <summary>
    /// Render the atlas for the given project.
    /// <list type="bullet">
    ///   <item><term><see cref="RenderOutcome.ProjectNotFound"/></term><description>project id is unknown (→ 404)</description></item>
    ///   <item><term><see cref="RenderOutcome.InvalidParameters"/></term><description>tier out of range (→ 400)</description></item>
    ///   <item><term><see cref="RenderOutcome.WorkerFailed"/></term><description>worker threw; record is marked Failed (→ 502)</description></item>
    ///   <item><term><see cref="RenderOutcome.Success"/></term><description>record is Completed, download URL populated (→ 200)</description></item>
    /// </list>
    /// </summary>
    Task<RenderServiceResult> RenderProjectAsync(
        Guid projectId,
        RenderProjectRequest request,
        CancellationToken ct = default);
}

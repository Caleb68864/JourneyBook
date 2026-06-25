namespace JourneyBook.Application.Rendering;

/// <summary>
/// Abstraction over the Node render-worker HTTP service. The real implementation
/// (<c>HttpRenderWorkerClient</c>) is a typed <c>HttpClient</c>; integration tests
/// inject a stub so no live worker process is required.
/// </summary>
public interface IRenderWorkerClient
{
    Task<RenderWorkerResult> RenderAsync(RenderWorkerRequest request, CancellationToken ct = default);
}

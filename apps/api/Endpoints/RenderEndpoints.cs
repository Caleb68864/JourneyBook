using JourneyBook.Application.Rendering;

namespace JourneyBook.Api.Endpoints;

public static class RenderEndpoints
{
    public static IEndpointRouteBuilder MapRenderEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/projects/{id:guid}/render", async (
            Guid id,
            RenderProjectRequest? request,
            IRenderService renderService,
            HttpContext httpContext) =>
        {
            var req = request ?? new RenderProjectRequest();
            var result = await renderService.RenderProjectAsync(id, req, httpContext.RequestAborted);

            return result.Outcome switch
            {
                RenderOutcome.ProjectNotFound => Results.NotFound(),
                RenderOutcome.InvalidParameters => Results.BadRequest(new { error = result.Error }),
                // 202, not 200: the render has been accepted and persisted, not
                // performed. Location points at the record the client polls — the
                // status resource, not the PDF, which does not exist yet.
                _ => Results.Accepted(
                    result.StatusUrl!,
                    new RenderProjectResponse(
                        result.GeneratedPdfId!.Value,
                        result.Status!,
                        result.DownloadUrl!,
                        result.StatusUrl!)),
            };
        });

        return app;
    }
}

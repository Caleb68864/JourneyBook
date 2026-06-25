using JourneyBook.Application.Rendering;

namespace JourneyBook.Api.Endpoints;

public static class RenderEndpoints
{
    public static IEndpointRouteBuilder MapRenderEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/projects/{id:guid}/render", async (
            Guid id,
            RenderProjectRequest? request,
            IRenderService renderService) =>
        {
            var req = request ?? new RenderProjectRequest();
            var result = await renderService.RenderProjectAsync(id, req);

            return result.Outcome switch
            {
                RenderOutcome.ProjectNotFound => Results.NotFound(),
                RenderOutcome.InvalidParameters => Results.BadRequest(new { error = result.Error }),
                RenderOutcome.WorkerFailed => Results.Json(
                    new RenderFailedResponse(result.GeneratedPdfId!.Value, result.Error ?? "Worker error."),
                    statusCode: StatusCodes.Status502BadGateway),
                _ => Results.Ok(new RenderProjectResponse(
                    result.GeneratedPdfId!.Value,
                    result.Status!,
                    result.DownloadUrl!)),
            };
        });

        return app;
    }
}

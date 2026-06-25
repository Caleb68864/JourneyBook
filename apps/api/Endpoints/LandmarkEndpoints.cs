using JourneyBook.Application.Landmarks;

namespace JourneyBook.Api.Endpoints;

public static class LandmarkEndpoints
{
    public static IEndpointRouteBuilder MapLandmarkEndpoints(this IEndpointRouteBuilder app)
    {
        var projectScoped = app.MapGroup("/api/projects/{projectId:guid}/landmarks");

        projectScoped.MapPost("/import", async (Guid projectId, ImportLandmarksRequest request, ILandmarkService service) =>
            await service.ImportAsync(projectId, request) is { } result
                ? Results.Ok(result)
                : Results.NotFound());

        projectScoped.MapGet("/", async (Guid projectId, ILandmarkService service) =>
            await service.ListAsync(projectId) is { } landmarks ? Results.Ok(landmarks) : Results.NotFound());

        var landmarks = app.MapGroup("/api/landmarks");

        landmarks.MapDelete("/{id:guid}", async (Guid id, ILandmarkService service) =>
            await service.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        return app;
    }
}

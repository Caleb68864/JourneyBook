using JourneyBook.Application.Projects;

namespace JourneyBook.Api.Endpoints;

public static class ProjectEndpoints
{
    public static IEndpointRouteBuilder MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/projects");

        group.MapPost("/", async (CreateProjectRequest request, IProjectService service) =>
        {
            try
            {
                var created = await service.CreateAsync(request);
                return Results.Created($"/api/projects/{created.Id}", created);
            }
            catch (ProjectValidationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapGet("/", async (IProjectService service) => Results.Ok(await service.ListAsync()));

        group.MapGet("/{id:guid}", async (Guid id, IProjectService service) =>
            await service.GetAsync(id) is { } project ? Results.Ok(project) : Results.NotFound());

        group.MapPut("/{id:guid}", async (Guid id, UpdateProjectRequest request, IProjectService service) =>
        {
            try
            {
                return await service.UpdateAsync(id, request) is { } updated
                    ? Results.Ok(updated)
                    : Results.NotFound();
            }
            catch (ProjectValidationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapDelete("/{id:guid}", async (Guid id, IProjectService service) =>
            await service.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        group.MapPut("/{id:guid}/extent", async (Guid id, BBoxDto bbox, IProjectService service) =>
            await service.SetExtentAsync(id, bbox) is { } project ? Results.Ok(project) : Results.NotFound());

        return app;
    }
}

using JourneyBook.Application.Locations;

namespace JourneyBook.Api.Endpoints;

public static class LocationEndpoints
{
    public static IEndpointRouteBuilder MapLocationEndpoints(this IEndpointRouteBuilder app)
    {
        var projectScoped = app.MapGroup("/api/projects/{projectId:guid}/locations");

        projectScoped.MapPost("/", async (Guid projectId, CreateLocationRequest request, ILocationService service) =>
        {
            try
            {
                return await service.CreateAsync(projectId, request) is { } created
                    ? Results.Created($"/api/locations/{created.Id}", created)
                    : Results.NotFound();
            }
            catch (LocationValidationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        projectScoped.MapPost("/import", async (Guid projectId, ImportLocationsRequest request, ILocationService service) =>
        {
            try
            {
                return await service.ImportAsync(projectId, request) is { } result
                    ? Results.Ok(result)
                    : Results.NotFound();
            }
            catch (LocationValidationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        projectScoped.MapGet("/", async (Guid projectId, ILocationService service) =>
            await service.ListAsync(projectId) is { } locations ? Results.Ok(locations) : Results.NotFound());

        var locations = app.MapGroup("/api/locations");

        locations.MapGet("/{id:guid}", async (Guid id, ILocationService service) =>
            await service.GetAsync(id) is { } location ? Results.Ok(location) : Results.NotFound());

        locations.MapPut("/{id:guid}", async (Guid id, UpdateLocationRequest request, ILocationService service) =>
        {
            try
            {
                return await service.UpdateAsync(id, request) is { } updated
                    ? Results.Ok(updated)
                    : Results.NotFound();
            }
            catch (LocationValidationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        locations.MapDelete("/{id:guid}", async (Guid id, ILocationService service) =>
            await service.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        return app;
    }
}

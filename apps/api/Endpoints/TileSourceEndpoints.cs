using JourneyBook.Application.TileSources;

namespace JourneyBook.Api.Endpoints;

public static class TileSourceEndpoints
{
    public static IEndpointRouteBuilder MapTileSourceEndpoints(this IEndpointRouteBuilder app)
    {
        var tileSources = app.MapGroup("/api/tile-sources");

        tileSources.MapPost("/", async (CreateTileSourceRequest request, ITileSourceService service) =>
        {
            try
            {
                var created = await service.CreateAsync(request);
                return Results.Created($"/api/tile-sources/{created.Id}", created);
            }
            catch (TileSourceValidationException ex)
            {
                return Results.Conflict(new { error = ex.Message });
            }
        });

        tileSources.MapGet("/", async (ITileSourceService service) =>
            Results.Ok(await service.ListAsync()));

        tileSources.MapGet("/{id:guid}", async (Guid id, ITileSourceService service) =>
            await service.GetAsync(id) is { } tileSource ? Results.Ok(tileSource) : Results.NotFound());

        tileSources.MapGet("/by-key/{key}", async (string key, ITileSourceService service) =>
            await service.GetByKeyAsync(key) is { } tileSource ? Results.Ok(tileSource) : Results.NotFound());

        tileSources.MapPut("/{id:guid}", async (Guid id, UpdateTileSourceRequest request, ITileSourceService service) =>
            await service.UpdateAsync(id, request) is { } updated ? Results.Ok(updated) : Results.NotFound());

        tileSources.MapDelete("/{id:guid}", async (Guid id, ITileSourceService service) =>
            await service.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        return app;
    }
}

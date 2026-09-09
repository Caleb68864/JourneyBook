using JourneyBook.Api;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Api.Endpoints;

public static class TileSourceEndpoints
{
    public static IEndpointRouteBuilder MapTileSourceEndpoints(this IEndpointRouteBuilder app)
    {
        var tileSources = app.MapGroup("/api/tile-sources");

        // Reads stay anonymous (the web app lists sources, and listing was never the
        // hole). Writes are gated: an anonymous POST here stored a URL the tile proxy
        // would then fetch and return the body of — a full SSRF with response
        // reflection. See AdminApiKeyGate for why this is a shared key rather than
        // real auth, and note that it fails closed when no key is configured.
        var writes = tileSources.MapGroup("").AddEndpointFilter(async (context, next) =>
        {
            var gate = context.HttpContext.RequestServices.GetRequiredService<AdminApiKeyGate>();
            var presented = context.HttpContext.Request.Headers[AdminApiKeyGate.HeaderName].ToString();
            if (!gate.IsAuthorized(presented))
            {
                return Results.Json(new { error = gate.DenialReason },
                    statusCode: StatusCodes.Status401Unauthorized);
            }
            return await next(context);
        });

        writes.MapPost("/", async (CreateTileSourceRequest request, ITileSourceService service) =>
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

        writes.MapPut("/{id:guid}", async (Guid id, UpdateTileSourceRequest request, ITileSourceService service) =>
            await service.UpdateAsync(id, request) is { } updated ? Results.Ok(updated) : Results.NotFound());

        writes.MapDelete("/{id:guid}", async (Guid id, ITileSourceService service) =>
            await service.DeleteAsync(id) ? Results.NoContent() : Results.NotFound());

        return app;
    }
}

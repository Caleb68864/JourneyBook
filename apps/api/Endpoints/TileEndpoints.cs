using JourneyBook.Application.Tiles;
using Microsoft.Extensions.Configuration;
using Microsoft.Net.Http.Headers;

namespace JourneyBook.Api.Endpoints;

public static class TileEndpoints
{
    public static IEndpointRouteBuilder MapTileEndpoints(this IEndpointRouteBuilder app)
    {
        // Unconditionally allow anonymous access to the whole tile route group so a
        // future global authorization policy can never gate it (spec SS-03 [AUTH]).
        var tilesGroup = app.MapGroup("/api/tiles").AllowAnonymous();

        tilesGroup.MapGet("/{source}/{z:int}/{x:int}/{y:int}", async (
            string source,
            int z,
            int x,
            int y,
            ITileService tiles,
            IConfiguration config,
            HttpRequest request,
            HttpResponse response,
            CancellationToken ct) =>
        {
            // Cheap coordinate validation first (no source lookup required). The
            // per-source MaxZoom ceiling is enforced by the service (ZoomOutOfRange),
            // not a hardcoded bound here (spec SS-03).
            if (z < 0 || x < 0 || y < 0)
            {
                return Results.BadRequest(new { error = "Invalid tile coordinates." });
            }

            // Bound x/y against the tile pyramid. Guard the shift so an out-of-band z
            // can't overflow; for any z beyond a real source the service returns
            // ZoomOutOfRange below.
            if (z <= 30)
            {
                var perAxis = 1 << z; // 2^z tiles per axis
                if (x >= perAxis || y >= perAxis)
                {
                    return Results.BadRequest(new { error = $"Tile x/y out of range for zoom {z}." });
                }
            }

            var tile = await tiles.GetTileAsync(source, z, x, y, ct);

            switch (tile.Status)
            {
                case TileStatus.UnknownSource:
                    return Results.NotFound();
                case TileStatus.ZoomOutOfRange:
                    return Results.BadRequest(new { error = "Zoom exceeds the source's maximum." });
                case TileStatus.UpstreamError:
                    return Results.StatusCode(StatusCodes.Status502BadGateway);
                case TileStatus.Empty:
                    return Results.StatusCode(StatusCodes.Status204NoContent);
            }

            response.Headers[HeaderNames.ETag] = tile.ETag;
            response.Headers["X-Tile-Attribution"] = tile.Attribution;
            response.Headers["X-Cache"] = tile.CacheHit ? "HIT" : "MISS";
            var maxAge = int.TryParse(config["TileCache:BrowserMaxAgeSeconds"], out var s) ? s : 604800;
            response.Headers[HeaderNames.CacheControl] = $"public, max-age={maxAge}";

            // Conditional GET: honor If-None-Match.
            var inm = request.Headers[HeaderNames.IfNoneMatch].ToString();
            if (!string.IsNullOrEmpty(inm) && inm == tile.ETag)
            {
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }

            return Results.File(tile.Bytes, tile.ContentType);
        });

        return app;
    }
}

using JourneyBook.Application.Tiles;
using Microsoft.Extensions.Configuration;
using Microsoft.Net.Http.Headers;

namespace JourneyBook.Api.Endpoints;

public static class TileEndpoints
{
    public static IEndpointRouteBuilder MapTileEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/tiles/{source}/{z:int}/{x:int}/{y:int}", async (
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
            // Cheap coordinate validation first (no source lookup required).
            if (z < 0 || x < 0 || y < 0 || z > 30)
            {
                return Results.BadRequest(new { error = "Invalid tile coordinates." });
            }

            var perAxis = 1 << z; // 2^z tiles per axis
            if (x >= perAxis || y >= perAxis)
            {
                return Results.BadRequest(new { error = $"Tile x/y out of range for zoom {z}." });
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

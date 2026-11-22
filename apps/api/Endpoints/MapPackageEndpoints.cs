using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Api.Endpoints;

public static class MapPackageEndpoints
{
    /// <summary>
    /// <c>GET /api/map-packages</c>: the offline packages under <c>TileCache:PmTilesDir</c>, each as
    /// its own PMTiles header describes it, with the <c>pmtiles</c> registry rows that serve it
    /// (Stage 7 manifest; see <see cref="MapPackageManifest"/>). Read-only, like the registry's GETs.
    /// </summary>
    public static IEndpointRouteBuilder MapMapPackageEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/map-packages", async (MapPackageManifest manifest, CancellationToken ct) =>
            Results.Ok(await manifest.ListAsync(ct)));
        return app;
    }
}

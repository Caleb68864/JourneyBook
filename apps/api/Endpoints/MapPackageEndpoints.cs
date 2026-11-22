using JourneyBook.Infrastructure.Tiles;
using JourneyBook.Api;

namespace JourneyBook.Api.Endpoints;

/// <summary>Body of <c>POST /api/map-packages/register</c>. <c>Key</c> defaults to one made from the file name.</summary>
public sealed record RegisterMapPackageRequest(string File, string? Key = null);

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

        // Register a package as a pmtiles tile source from the archive's own header and metadata.
        // A registry write, so behind the same admin key as POST /api/tile-sources.
        app.MapPost("/api/map-packages/register", async (RegisterMapPackageRequest request, MapPackageManifest manifest, CancellationToken ct) =>
        {
            try
            {
                var created = await manifest.RegisterAsync(request.File, request.Key, ct);
                return Results.Created($"/api/tile-sources/{created.Id}", created);
            }
            catch (MapPackageRegistrationException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: ex.Status);
            }
        }).AddEndpointFilter(AdminApiKeyGate.Filter);
        return app;
    }
}

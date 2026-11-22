using JourneyBook.Infrastructure.Tiles;
using JourneyBook.Api;

namespace JourneyBook.Api.Endpoints;

/// <summary>
/// Body of <c>POST /api/map-packages</c>: a raster package of the default tile source (USGS topo,
/// owner decision b) for <c>Bbox</c> [W,S,E,N] at <c>MinZoom..MaxZoom</c>. <c>File</c> defaults to
/// <c>{Key}.pmtiles</c>, else a timestamped name; <c>Key</c> is the tile source to register.
/// </summary>
public sealed record CreateMapPackageRequest(double[] Bbox, int MinZoom, int MaxZoom, string? File = null, string? Key = null, int? MaxTiles = null);

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

        // Make a package (the worker fetches through this API's own tile proxy, like a render) and
        // register it when it lands. 202: it can take minutes. Admin-gated: it writes to the
        // registry and to disk, and fetches many tiles from a public source.
        app.MapPost("/api/map-packages", async (
            CreateMapPackageRequest request, MapPackageJobs jobs, IConfiguration config, CancellationToken ct) =>
        {
            if (request.Bbox is not { Length: 4 })
            {
                return Results.BadRequest(new { error = "bbox must be [W, S, E, N]." });
            }
            var file = request.File is { Length: > 0 } f ? f
                : request.Key is { Length: > 0 } k ? $"{k}.pmtiles"
                : $"package-{DateTime.UtcNow:yyyyMMdd-HHmmss}.pmtiles";
            var proxy = config["Tiles:ProxyBaseUrl"] is { Length: > 0 } u ? u : null;
            var source = config["Tiles:DefaultSource"] is { Length: > 0 } s ? s : "usgs-topo";
            try
            {
                var status = await jobs.StartAsync(new PackageWorkerRequest(
                    request.Bbox, request.MinZoom, request.MaxZoom, file,
                    TileBaseUrl: proxy, TileSourceId: proxy is null ? null : source, MaxTiles: request.MaxTiles), request.Key, ct);
                return Results.Accepted($"/api/map-packages/jobs/{status.Id}", status);
            }
            catch (PackageWorkerRefusedException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: ex.Status);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                // The worker is down or not answering: a gateway failure, not our 500.
                return Results.Json(new { error = $"The render worker could not be reached: {ex.Message}" },
                    statusCode: StatusCodes.Status502BadGateway);
            }
        }).AddEndpointFilter(AdminApiKeyGate.Filter);

        app.MapGet("/api/map-packages/jobs/{id}", (string id, MapPackageJobs jobs) =>
            jobs.Get(id) is { } status ? Results.Ok(status) : Results.NotFound(new { error = $"No package job {id}." }));
        return app;
    }
}

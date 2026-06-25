using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Landmarks;
using JourneyBook.Application.Locations;
using JourneyBook.Application.Projects;
using JourneyBook.Application.Rendering;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.GeneratedPdfs;
using JourneyBook.Infrastructure.Landmarks;
using JourneyBook.Infrastructure.Locations;
using JourneyBook.Application.Tiles;
using JourneyBook.Infrastructure.Persistence;
using JourneyBook.Infrastructure.Projects;
using JourneyBook.Infrastructure.Rendering;
using JourneyBook.Infrastructure.TileSources;
using JourneyBook.Infrastructure.Tiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace JourneyBook.Infrastructure;

/// <summary>
/// Composition root for the Infrastructure layer: EF Core / Npgsql / PostGIS
/// and (later) repositories and external integrations.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString =
            configuration.GetConnectionString("Postgres")
            ?? "Host=localhost;Port=5433;Database=journeybook;Username=journeybook;Password=journeybook";

        services.AddDbContext<JourneyBookDbContext>(options =>
            options.UseNpgsql(connectionString, npgsql => npgsql.UseNetTopologySuite()));

        services.AddScoped<IProjectService, ProjectService>();
        services.AddScoped<ILocationService, LocationService>();
        services.AddScoped<ITileSourceService, TileSourceService>();
        services.AddScoped<IGeneratedPdfService, GeneratedPdfService>();

        // --- Tile proxy (Stage 3) -------------------------------------------
        var cacheDir = configuration["TileCache:CacheDir"] is { Length: > 0 } dir ? dir : "data/cache";
        services.AddSingleton(new TileCache(cacheDir));

        var upstreamTimeout = int.TryParse(configuration["TileCache:UpstreamTimeoutSeconds"], out var t) ? t : 10;
        services.AddHttpClient<RasterXyzFetcher>(http =>
            http.Timeout = TimeSpan.FromSeconds(upstreamTimeout));
        services.AddScoped<ITileFetcher>(sp => sp.GetRequiredService<RasterXyzFetcher>());

        services.AddHttpClient<PmTilesFetcher>(http =>
            http.Timeout = TimeSpan.FromSeconds(upstreamTimeout));
        services.AddScoped<ITileFetcher>(sp => sp.GetRequiredService<PmTilesFetcher>());

        services.AddScoped<ITileService, TileService>();

        // --- Render worker (Stage 3) ----------------------------------------
        var workerBaseUrl = configuration["RenderWorker:BaseUrl"] is { Length: > 0 } u ? u : "http://render-worker:8090";
        var workerTimeout = int.TryParse(configuration["RenderWorker:TimeoutSeconds"], out var wt) ? wt : 120;

        services.AddHttpClient<IRenderWorkerClient, HttpRenderWorkerClient>(http =>
        {
            http.BaseAddress = new Uri(workerBaseUrl);
            http.Timeout = TimeSpan.FromSeconds(workerTimeout);
        });

        services.AddScoped<IRenderService, RenderService>();

        // --- Landmarks / Overpass (Stage 6) ---------------------------------
        services.AddScoped<ILandmarkService, LandmarkService>();

        var overpassBaseUrl = configuration["Overpass:BaseUrl"] is { Length: > 0 } ou ? ou : "https://overpass-api.de";
        var overpassTimeout = int.TryParse(configuration["Overpass:TimeoutSeconds"], out var ot) ? ot : 30;

        services.AddHttpClient<IOverpassClient, OverpassClient>(http =>
        {
            http.BaseAddress = new Uri(overpassBaseUrl);
            http.Timeout = TimeSpan.FromSeconds(overpassTimeout);
        });

        return services;
    }
}

using System.Net;
using System.Net.Sockets;
using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Geocoding;
using JourneyBook.Application.Landmarks;
using JourneyBook.Application.Locations;
using JourneyBook.Application.Projects;
using JourneyBook.Application.Rendering;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.GeneratedPdfs;
using JourneyBook.Infrastructure.Geocoding;
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

        // --- Tile egress policy (SSRF containment) --------------------------
        // The tile registry stores a URL and the proxy fetches it and returns the
        // body, so without this the API is a request forwarder for whoever can
        // POST /api/tile-sources. See TileEgressPolicy for why enforcement is at
        // the socket rather than on the URL string.
        var egressPolicy = new TileEgressPolicy(
            allowedHosts: configuration.GetSection("Tiles:AllowedHosts").Get<string[]>(),
            allowPrivateNetworks: configuration.GetValue("Tiles:AllowPrivateNetworks", false),
            allowedSchemes: configuration.GetSection("Tiles:AllowedSchemes").Get<string[]>());
        services.AddSingleton(egressPolicy);

        services.AddHttpClient<RasterXyzFetcher>(http =>
            http.Timeout = TimeSpan.FromSeconds(upstreamTimeout))
            .ConfigurePrimaryHttpMessageHandler(() => CreateGuardedHandler(egressPolicy));
        services.AddScoped<ITileFetcher>(sp => sp.GetRequiredService<RasterXyzFetcher>());

        services.AddHttpClient<PmTilesFetcher>(http =>
            http.Timeout = TimeSpan.FromSeconds(upstreamTimeout))
            .ConfigurePrimaryHttpMessageHandler(() => CreateGuardedHandler(egressPolicy));
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
        var overpassUserAgent = configuration["Overpass:UserAgent"] is { Length: > 0 } oua ? oua : "JourneyBook/1.0 (atlas landmark import)";

        services.AddHttpClient<IOverpassClient, OverpassClient>(http =>
        {
            http.BaseAddress = new Uri(overpassBaseUrl);
            http.Timeout = TimeSpan.FromSeconds(overpassTimeout);
            // Overpass returns 406 Not Acceptable without a descriptive User-Agent
            // (same policy as Nominatim) — every import silently returned [] without it.
            http.DefaultRequestHeaders.UserAgent.ParseAdd(overpassUserAgent);
        });

        // --- Geocoding / Nominatim (address search) -------------------------
        var nominatimBaseUrl = configuration["Geocode:BaseUrl"] is { Length: > 0 } gu ? gu : "https://nominatim.openstreetmap.org";
        var nominatimTimeout = int.TryParse(configuration["Geocode:TimeoutSeconds"], out var gt) ? gt : 15;
        var nominatimUserAgent = configuration["Geocode:UserAgent"] is { Length: > 0 } ua ? ua : "JourneyBook/1.0 (atlas address search)";

        services.AddHttpClient<IGeocodeClient, NominatimClient>(http =>
        {
            http.BaseAddress = new Uri(nominatimBaseUrl);
            http.Timeout = TimeSpan.FromSeconds(nominatimTimeout);
            // Nominatim's usage policy requires a descriptive User-Agent.
            http.DefaultRequestHeaders.UserAgent.ParseAdd(nominatimUserAgent);
        });

        return services;
    }

    /// <summary>
    /// A handler that refuses to open a socket to a blocked address.
    ///
    /// <para>
    /// The check lives in <c>ConnectCallback</c> rather than on the URL because
    /// that is the only place that sees the address actually being connected to.
    /// A hostname check can be defeated by an attacker's own DNS answering a
    /// public address at validation time and a private one at fetch time; the
    /// callback runs per connection, after resolution, so rebinding does not
    /// help. Redirects are refused outright as well — following a 302 to
    /// <c>169.254.169.254</c> is the other half of the same bypass, and no tile
    /// endpoint this product supports needs redirects.
    /// </para>
    /// </summary>
    private static SocketsHttpHandler CreateGuardedHandler(TileEgressPolicy policy) => new()
    {
        AllowAutoRedirect = false,
        ConnectCallback = async (context, ct) =>
        {
            var host = context.DnsEndPoint.Host;
            var port = context.DnsEndPoint.Port;

            var addresses = IPAddress.TryParse(host, out var literal)
                ? [literal]
                : await Dns.GetHostAddressesAsync(host, ct);

            // Every candidate must be acceptable. Connecting to the first allowed
            // address of a name that also resolves to a private one would let an
            // attacker win the race by ordering their DNS answers.
            foreach (var address in addresses)
            {
                if (policy.IsBlockedAddress(address))
                {
                    throw new HttpRequestException(
                        $"Refusing to connect to '{host}' ({address}): blocked by the tile egress policy.");
                }
            }

            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                // Connect to the addresses we just vetted, not to the hostname —
                // re-resolving here would reopen the very race this closes.
                await socket.ConnectAsync(addresses, port, ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };
}

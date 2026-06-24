using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.Tiles;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace JourneyBook.Tests.Api;

/// <summary>
/// PostGIS-backed factory for the tile-proxy endpoint tests. Points the disk cache at a throwaway
/// temp dir (so runs don't contaminate each other) and replaces the real network-bound raster
/// fetcher with a deterministic fake — the endpoint, cache, headers, and dispatch are exercised
/// without hitting USGS. The live raster fetch is covered by the spec's manual curl verification.
/// </summary>
public class TilesApiFactory : PostgisApiFactory
{
    public string CacheDir { get; } = Path.Combine(Path.GetTempPath(), "jb-tiles-it-" + Guid.NewGuid().ToString("N"));

    /// <summary>The canned tile bytes the fake fetcher returns for raster sources.</summary>
    public static readonly byte[] FakeTileBytes = [0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4];

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("TileCache:CacheDir", CacheDir);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ITileFetcher>();
            services.AddSingleton<ITileFetcher, FakeRasterFetcher>();
        });
    }
}

/// <summary>Deterministic stand-in for the raster fetcher — no network.</summary>
public sealed class FakeRasterFetcher : ITileFetcher
{
    public bool CanHandle(string kind) => kind is "usgs-raster" or "xyz-server";

    public Task<FetchedTile?> FetchAsync(TileSourceResponse source, int z, int x, int y, CancellationToken ct) =>
        Task.FromResult<FetchedTile?>(new FetchedTile(TilesApiFactory.FakeTileBytes, "image/png", Empty: false));
}

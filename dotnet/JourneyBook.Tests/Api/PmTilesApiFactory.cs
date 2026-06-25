using Microsoft.AspNetCore.Hosting;

namespace JourneyBook.Tests.Api;

/// <summary>
/// PostGIS-backed factory for PMTiles dispatch tests. Points the cache + archives roots at throwaway
/// temp dirs, writes the fixture archive into the archives root, and keeps the real fetchers
/// (RasterXyzFetcher + PmTilesFetcher) so the proxy resolves a <c>pmtiles</c> source end-to-end.
/// </summary>
public class PmTilesApiFactory : PostgisApiFactory
{
    public string CacheDir { get; } = Path.Combine(Path.GetTempPath(), "jb-pmt-cache-" + Guid.NewGuid().ToString("N"));
    public string PmTilesDir { get; } = Path.Combine(Path.GetTempPath(), "jb-pmt-arch-" + Guid.NewGuid().ToString("N"));

    public const string FixtureFile = "fixture.pmtiles";

    public PmTilesApiFactory()
    {
        PmTilesFixture.WriteTo(PmTilesDir, FixtureFile);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("TileCache:CacheDir", CacheDir);
        builder.UseSetting("TileCache:PmTilesDir", PmTilesDir);
    }
}

using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests.Api;

/// <summary>
/// The Stage 7 manifest: each package under <c>TileCache:PmTilesDir</c>, described by its own
/// header, with the registry rows serving it. Read against the shared raster fixture, whose
/// header the TS writer made (<c>packages/render-cli/src/package.test.ts</c>).
/// </summary>
public class MapPackagesApiTests(PmTilesApiFactory factory) : IClassFixture<PmTilesApiFactory>
{
    [Fact]
    public async Task Lists_each_package_with_its_header_and_the_rows_that_serve_it()
    {
        var manifest = JourneyBook.Tests.RasterPackageFixtureTests.LoadManifest();
        Directory.CreateDirectory(Path.Combine(factory.PmTilesDir, "ne"));
        File.Copy(Path.Combine(JourneyBook.Tests.RasterPackageFixtureTests.FixtureDir(), "package.pmtiles"),
            Path.Combine(factory.PmTilesDir, "ne", "lincoln.pmtiles"), overwrite: true);
        await File.WriteAllTextAsync(Path.Combine(factory.PmTilesDir, "broken.pmtiles"), "not an archive");

        var admin = factory.CreateAdminClient();
        var post = await admin.PostAsJsonAsync("/api/tile-sources", new CreateTileSourceRequest(
            Key: "lincoln-package", Provider: "USGS", SourceUrl: "ne/lincoln.pmtiles",
            Attribution: "USGS The National Map", MaxZoom: manifest.MaxZoom,
            Cache: new TileCachePolicyDto(86400, true), Kind: "pmtiles"));
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var client = factory.CreateClient();
        var res = await client.GetAsync("/api/map-packages");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var list = (await res.Content.ReadFromJsonAsync<List<MapPackageEntry>>())!;

        var pkg = Assert.Single(list, p => p.File == "ne/lincoln.pmtiles");
        Assert.Equal("png", pkg.TileType);
        Assert.Equal(manifest.MinZoom, pkg.MinZoom);
        Assert.Equal(manifest.MaxZoom, pkg.MaxZoom);
        Assert.Equal(manifest.Tiles.Count, pkg.AddressedTiles);
        // The bounds the TS writer was given for the fixture.
        Assert.Equal([-97.0, 40.5, -96.5, 41.0], pkg.Bbox!);
        Assert.Equal(["lincoln-package"], pkg.SourceKeys);
        Assert.Null(pkg.Error);

        // An unreadable file is listed with the reason, not dropped and not a 500.
        var broken = Assert.Single(list, p => p.File == "broken.pmtiles");
        Assert.NotNull(broken.Error);
        Assert.Null(broken.MinZoom);
        Assert.Empty(broken.SourceKeys);

        // The factory's own fixture archive is there too, served by no row in this test.
        Assert.Contains(list, p => p.File == PmTilesApiFactory.FixtureFile);
    }
}

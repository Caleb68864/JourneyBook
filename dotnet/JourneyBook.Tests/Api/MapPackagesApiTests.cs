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

    /// <summary>
    /// Registering a package used to mean copying it in and hand-typing a POST to
    /// /api/tile-sources (kind, file name, max zoom, credit, offline flag). It is now one call,
    /// filled from the archive, and the new row serves tiles.
    /// </summary>
    [Fact]
    public async Task Registers_a_package_from_its_own_header_and_metadata_and_serves_it()
    {
        var manifest = JourneyBook.Tests.RasterPackageFixtureTests.LoadManifest();
        Directory.CreateDirectory(Path.Combine(factory.PmTilesDir, "reg"));
        File.Copy(Path.Combine(JourneyBook.Tests.RasterPackageFixtureTests.FixtureDir(), "package.pmtiles"),
            Path.Combine(factory.PmTilesDir, "reg", "Lincoln Trip.pmtiles"), overwrite: true);
        var admin = factory.CreateAdminClient();

        var res = await admin.PostAsJsonAsync("/api/map-packages/register", new { file = "reg/Lincoln Trip.pmtiles" });

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var row = (await res.Content.ReadFromJsonAsync<TileSourceResponse>())!;
        Assert.Equal("package-reg-lincoln-trip", row.Key);
        Assert.Equal("pmtiles", row.Kind);
        Assert.Equal("reg/Lincoln Trip.pmtiles", row.SourceUrl);
        Assert.Equal(manifest.MaxZoom, row.MaxZoom);
        Assert.Equal("USGS The National Map", row.Attribution);
        Assert.True(row.Cache.OfflineAllowed);

        var t = manifest.Tiles[0];
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/tiles/{row.Key}/{t.Z}/{t.X}/{t.Y}")).StatusCode);

        // Registering it again is a conflict on the key, not a second row.
        var again = await admin.PostAsJsonAsync("/api/map-packages/register", new { file = "reg/Lincoln Trip.pmtiles" });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Refuses_what_it_cannot_vouch_for()
    {
        var admin = factory.CreateAdminClient();
        var fixture = Path.Combine(JourneyBook.Tests.RasterPackageFixtureTests.FixtureDir(), "package.pmtiles");

        // No admin key: a registry write like any other.
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await factory.CreateClient().PostAsJsonAsync("/api/map-packages/register", new { file = PmTilesApiFactory.FixtureFile })).StatusCode);
        // Outside the packages folder, and missing.
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/map-packages/register", new { file = "../escape.pmtiles" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await admin.PostAsJsonAsync("/api/map-packages/register", new { file = "nope.pmtiles" })).StatusCode);
        // An archive that does not say where it came from (the minimal fixture has no metadata).
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/map-packages/register", new { file = PmTilesApiFactory.FixtureFile })).StatusCode);

        // Made from a source whose terms do not allow offline use: same bytes, metadata source patched.
        var bytes = await File.ReadAllBytesAsync(fixture);
        var from = System.Text.Encoding.ASCII.GetBytes("\"source\":\"usgs-topo\"");
        var to = System.Text.Encoding.ASCII.GetBytes("\"source\":\"closed-ts\"");
        var at = bytes.AsSpan().IndexOf(from);
        Assert.True(at > 0, "fixture metadata not found");
        to.CopyTo(bytes, at);
        await File.WriteAllBytesAsync(Path.Combine(factory.PmTilesDir, "closed.pmtiles"), bytes);
        var closed = await admin.PostAsJsonAsync("/api/tile-sources", new CreateTileSourceRequest(
            Key: "closed-ts", Provider: "Closed", SourceUrl: "https://tiles.example.com/{z}/{x}/{y}.png",
            Attribution: "Closed Maps", MaxZoom: 16, Cache: new TileCachePolicyDto(3600, false), Kind: "xyz-server"));
        Assert.Equal(HttpStatusCode.Created, closed.StatusCode);
        var refused = await admin.PostAsJsonAsync("/api/map-packages/register", new { file = "closed.pmtiles" });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("do not allow offline use", await refused.Content.ReadAsStringAsync());
    }
}

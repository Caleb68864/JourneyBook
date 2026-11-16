using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Tests.Api;

/// <summary>
/// The same package registered as a <c>pmtiles</c> tile-source row and served by the proxy, which is
/// how a render (worker or <c>render-cli --tile-base-url</c>) would draw from it.
/// </summary>
public class RasterPackageTilesApiTests(PmTilesApiFactory factory) : IClassFixture<PmTilesApiFactory>
{
    [Fact]
    public async Task A_packaged_tile_is_served_through_the_proxy()
    {
        var manifest = JourneyBook.Tests.RasterPackageFixtureTests.LoadManifest();
        File.Copy(Path.Combine(JourneyBook.Tests.RasterPackageFixtureTests.FixtureDir(), "package.pmtiles"),
            Path.Combine(factory.PmTilesDir, "usgs-package.pmtiles"), overwrite: true);

        var admin = factory.CreateAdminClient();
        var post = await admin.PostAsJsonAsync("/api/tile-sources", new CreateTileSourceRequest(
            Key: "usgs-package", Provider: "USGS", SourceUrl: "usgs-package.pmtiles",
            Attribution: "USGS The National Map", MaxZoom: manifest.MaxZoom,
            Cache: new TileCachePolicyDto(86400, true), Kind: "pmtiles"));
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        foreach (var t in manifest.Tiles)
        {
            var res = await admin.GetAsync($"/api/tiles/usgs-package/{t.Z}/{t.X}/{t.Y}");
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            Assert.Equal("image/png", res.Content.Headers.ContentType?.MediaType);
            Assert.Equal(t.Sha256, Convert.ToHexString(SHA256.HashData(await res.Content.ReadAsByteArrayAsync())).ToLowerInvariant());
        }
        var absent = manifest.Absent[0];
        Assert.Equal(HttpStatusCode.NoContent, (await admin.GetAsync($"/api/tiles/usgs-package/{absent.Z}/{absent.X}/{absent.Y}")).StatusCode);
    }
}

using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Tests.Api;

public class PmTilesTilesApiTests(PmTilesApiFactory factory) : IClassFixture<PmTilesApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task SeedSourceAsync(string key, string sourceUrl)
    {
        var create = new CreateTileSourceRequest(
            Key: key,
            Provider: "Protomaps",
            SourceUrl: sourceUrl,
            Attribution: "© OpenStreetMap contributors",
            MaxZoom: 14,
            Cache: new TileCachePolicyDto(0, false),
            Kind: "pmtiles");
        var res = await _client.PostAsJsonAsync("/api/tile-sources", create);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    [Fact]
    public async Task Present_pmtiles_tile_is_served()
    {
        await SeedSourceAsync("pmt-present", PmTilesApiFactory.FixtureFile);

        var res = await _client.GetAsync($"/api/tiles/pmt-present/{PmTilesFixture.Z}/{PmTilesFixture.X}/{PmTilesFixture.Y}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("image/png", res.Content.Headers.ContentType?.MediaType);

        var bytes = await res.Content.ReadAsByteArrayAsync();
        Assert.Equal(PmTilesFixture.TilePayload, bytes);
    }

    [Fact]
    public async Task Absent_pmtiles_tile_returns_204()
    {
        await SeedSourceAsync("pmt-absent", PmTilesApiFactory.FixtureFile);

        var res = await _client.GetAsync($"/api/tiles/pmt-absent/{PmTilesFixture.Z}/{PmTilesFixture.AbsentX}/{PmTilesFixture.AbsentY}");
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task Archive_path_escaping_root_is_refused_502()
    {
        await SeedSourceAsync("pmt-escape", "../../../../etc/passwd");

        var res = await _client.GetAsync($"/api/tiles/pmt-escape/{PmTilesFixture.Z}/{PmTilesFixture.X}/{PmTilesFixture.Y}");
        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
    }
}

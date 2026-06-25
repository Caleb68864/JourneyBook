using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests.Api;

/// <summary>
/// Direct unit tests for <see cref="PmTilesReader"/> against the in-memory fixture archive — no HTTP,
/// no PostGIS. Proves the Hilbert tile-id mapping and the sparse-miss path independently of the API.
/// </summary>
public class PmTilesReaderTests
{
    [Fact]
    public async Task Known_coord_returns_fixture_tile_bytes()
    {
        using var archive = new MemoryStream(PmTilesFixture.Build());
        var reader = new PmTilesReader();

        var bytes = await reader.ReadTileAsync(archive, PmTilesFixture.Z, PmTilesFixture.X, PmTilesFixture.Y, CancellationToken.None);

        Assert.NotNull(bytes);
        Assert.Equal(PmTilesFixture.TilePayload, bytes);
    }

    [Fact]
    public async Task Absent_coord_returns_null()
    {
        using var archive = new MemoryStream(PmTilesFixture.Build());
        var reader = new PmTilesReader();

        var bytes = await reader.ReadTileAsync(archive, PmTilesFixture.Z, PmTilesFixture.AbsentX, PmTilesFixture.AbsentY, CancellationToken.None);

        Assert.Null(bytes);
    }

    [Fact]
    public async Task Tile_type_byte_is_png()
    {
        using var archive = new MemoryStream(PmTilesFixture.Build());
        var reader = new PmTilesReader();

        var tileType = await reader.ReadTileTypeAsync(archive, CancellationToken.None);

        Assert.Equal(2, tileType); // 2 = png
    }

    [Fact]
    public void Hilbert_mapping_matches_fixture_directory_entry()
    {
        // The fixture writes its single directory entry under ZxyToTileId(Z,X,Y); a different coord
        // must map to a different tile id, which is what drives the sparse miss above.
        var present = PmTilesReader.ZxyToTileId(PmTilesFixture.Z, PmTilesFixture.X, PmTilesFixture.Y);
        var absent = PmTilesReader.ZxyToTileId(PmTilesFixture.Z, PmTilesFixture.AbsentX, PmTilesFixture.AbsentY);

        Assert.NotEqual(present, absent);
    }
}

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

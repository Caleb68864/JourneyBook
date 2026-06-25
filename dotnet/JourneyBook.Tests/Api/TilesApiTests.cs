using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Tests.Api;

public class TilesApiTests(TilesApiFactory factory) : IClassFixture<TilesApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Tile_miss_then_hit_serves_bytes_with_headers()
    {
        // First request: cache miss → fetched (fake) and stored.
        var miss = await _client.GetAsync("/api/tiles/usgs-topo/2/1/1");
        Assert.Equal(HttpStatusCode.OK, miss.StatusCode);
        Assert.Equal("image/png", miss.Content.Headers.ContentType?.MediaType);
        Assert.Equal("MISS", miss.Headers.GetValues("X-Cache").Single());
        Assert.Equal("USGS The National Map", miss.Headers.GetValues("X-Tile-Attribution").Single());
        Assert.NotNull(miss.Headers.ETag);
        Assert.True(miss.Headers.CacheControl?.Public);
        var bytes = await miss.Content.ReadAsByteArrayAsync();
        Assert.Equal(TilesApiFactory.FakeTileBytes, bytes);

        // Second request, same tile: cache hit.
        var hit = await _client.GetAsync("/api/tiles/usgs-topo/2/1/1");
        Assert.Equal(HttpStatusCode.OK, hit.StatusCode);
        Assert.Equal("HIT", hit.Headers.GetValues("X-Cache").Single());
    }

    [Fact]
    public async Task If_none_match_returns_304()
    {
        var first = await _client.GetAsync("/api/tiles/usgs-topo/3/2/2");
        var etag = first.Headers.ETag!;

        var req = new HttpRequestMessage(HttpMethod.Get, "/api/tiles/usgs-topo/3/2/2");
        req.Headers.IfNoneMatch.Add(etag);
        var second = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);
    }

    [Fact]
    public async Task Unknown_source_returns_404()
    {
        var res = await _client.GetAsync("/api/tiles/no-such-source/2/1/1");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Zoom_above_source_maxzoom_returns_400()
    {
        // Seeded usgs-topo MaxZoom is 16.
        var res = await _client.GetAsync("/api/tiles/usgs-topo/20/1/1");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Out_of_range_xy_returns_400()
    {
        // At z=1 there are only 2x2 tiles (valid x,y ∈ {0,1}); x=5 is out of range.
        var res = await _client.GetAsync("/api/tiles/usgs-topo/1/5/0");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }
}

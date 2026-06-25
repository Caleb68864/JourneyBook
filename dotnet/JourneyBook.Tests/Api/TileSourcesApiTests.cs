using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Tests.Api;

public class TileSourcesApiTests(PostgisApiFactory factory) : IClassFixture<PostgisApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task List_includes_seeded_usgs_topo()
    {
        var list = await _client.GetFromJsonAsync<List<TileSourceResponse>>("/api/tile-sources");
        Assert.NotNull(list);
        Assert.Contains(list!, t => t.Key == "usgs-topo");
    }

    [Fact]
    public async Task GetByKey_usgs_topo_returns_correct_cache_max_age()
    {
        var result = await _client.GetFromJsonAsync<TileSourceResponse>("/api/tile-sources/by-key/usgs-topo");
        Assert.NotNull(result);
        Assert.Equal(86400, result!.Cache.MaxAgeSeconds);
    }

    [Fact]
    public async Task Create_then_get_round_trips_cache_policy()
    {
        var request = new CreateTileSourceRequest(
            Key: "test-source",
            Provider: "TestProvider",
            SourceUrl: "https://example.com/tiles/{z}/{x}/{y}",
            Attribution: "Test Attribution",
            MaxZoom: 18,
            Cache: new TileCachePolicyDto(3600, true));

        var post = await _client.PostAsJsonAsync("/api/tile-sources", request);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var created = await post.Content.ReadFromJsonAsync<TileSourceResponse>();
        Assert.NotNull(created);
        Assert.Equal("test-source", created!.Key);
        Assert.Equal(3600, created.Cache.MaxAgeSeconds);
        Assert.True(created.Cache.OfflineAllowed);

        var fetched = await _client.GetFromJsonAsync<TileSourceResponse>($"/api/tile-sources/{created.Id}");
        Assert.NotNull(fetched);
        Assert.Equal(3600, fetched!.Cache.MaxAgeSeconds);
        Assert.True(fetched.Cache.OfflineAllowed);
    }

    [Fact]
    public async Task Create_duplicate_key_returns_409()
    {
        var request = new CreateTileSourceRequest(
            Key: "duplicate-key",
            Provider: "P1",
            SourceUrl: "https://example.com/a",
            Attribution: "A",
            MaxZoom: 10,
            Cache: new TileCachePolicyDto(0, false));

        var first = await _client.PostAsJsonAsync("/api/tile-sources", request);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await _client.PostAsJsonAsync("/api/tile-sources", request with { Provider = "P2" });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Update_replaces_mutable_fields()
    {
        var create = new CreateTileSourceRequest(
            Key: "update-target",
            Provider: "OldProvider",
            SourceUrl: "https://example.com/old",
            Attribution: "Old",
            MaxZoom: 10,
            Cache: new TileCachePolicyDto(100, false));

        var post = await _client.PostAsJsonAsync("/api/tile-sources", create);
        var created = await post.Content.ReadFromJsonAsync<TileSourceResponse>();
        Assert.NotNull(created);

        var update = new UpdateTileSourceRequest(
            Provider: "NewProvider",
            SourceUrl: "https://example.com/new",
            Attribution: "New",
            MaxZoom: 15,
            Cache: new TileCachePolicyDto(200, true));

        var put = await _client.PutAsJsonAsync($"/api/tile-sources/{created!.Id}", update);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var updated = await put.Content.ReadFromJsonAsync<TileSourceResponse>();
        Assert.NotNull(updated);
        Assert.Equal("NewProvider", updated!.Provider);
        Assert.Equal(200, updated.Cache.MaxAgeSeconds);
        Assert.True(updated.Cache.OfflineAllowed);
        Assert.Equal("update-target", updated.Key);
    }

    [Fact]
    public async Task Delete_removes_source()
    {
        var create = new CreateTileSourceRequest(
            Key: "delete-me",
            Provider: "P",
            SourceUrl: "https://example.com/d",
            Attribution: "D",
            MaxZoom: 5,
            Cache: new TileCachePolicyDto(0, false));

        var post = await _client.PostAsJsonAsync("/api/tile-sources", create);
        var created = await post.Content.ReadFromJsonAsync<TileSourceResponse>();
        Assert.NotNull(created);

        var del = await _client.DeleteAsync($"/api/tile-sources/{created!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var get = await _client.GetAsync($"/api/tile-sources/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task GetByKey_unknown_key_returns_404()
    {
        var get = await _client.GetAsync("/api/tile-sources/by-key/no-such-key");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Create_with_kind_round_trips_kind()
    {
        var request = new CreateTileSourceRequest(
            Key: "kind-pmtiles",
            Provider: "Protomaps",
            SourceUrl: "data/map-packages/world.pmtiles",
            Attribution: "© OpenStreetMap contributors",
            MaxZoom: 14,
            Cache: new TileCachePolicyDto(86400, true),
            Kind: "pmtiles");

        var post = await _client.PostAsJsonAsync("/api/tile-sources", request);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var fetched = await _client.GetFromJsonAsync<TileSourceResponse>("/api/tile-sources/by-key/kind-pmtiles");
        Assert.NotNull(fetched);
        Assert.Equal("pmtiles", fetched!.Kind);
    }

    [Fact]
    public async Task Create_without_kind_defaults_to_usgs_raster()
    {
        var request = new CreateTileSourceRequest(
            Key: "kind-default",
            Provider: "P",
            SourceUrl: "https://example.com/{z}/{x}/{y}",
            Attribution: "A",
            MaxZoom: 10,
            Cache: new TileCachePolicyDto(0, false));

        var post = await _client.PostAsJsonAsync("/api/tile-sources", request);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var fetched = await _client.GetFromJsonAsync<TileSourceResponse>("/api/tile-sources/by-key/kind-default");
        Assert.NotNull(fetched);
        Assert.Equal("usgs-raster", fetched!.Kind);
    }

    [Fact]
    public async Task Seeded_usgs_topo_has_usgs_raster_kind()
    {
        var result = await _client.GetFromJsonAsync<TileSourceResponse>("/api/tile-sources/by-key/usgs-topo");
        Assert.NotNull(result);
        Assert.Equal("usgs-raster", result!.Kind);
    }
}

using System.Net;
using JourneyBook.Application.TileSources;
using JourneyBook.Application.Tiles;
using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests;

/// <summary>
/// An upstream that says "busy" (429, or 503) is passed on with its Retry-After, not flattened
/// into a bare 502. The render worker honours Retry-After (map-sources <c>fetchTile</c>), and in
/// compose it reaches USGS only through this proxy, so a 502 here hid the window it should wait
/// out. Docker-free: a stub HttpMessageHandler stands in for the source.
/// </summary>
public class TileThrottlePassThroughTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 11, 21, 12, 0, 0, TimeSpan.Zero);

    private readonly string _root = Path.Combine(Path.GetTempPath(), "jb-throttle-" + Guid.NewGuid().ToString("N"));

    private static readonly TileSourceResponse Source = new(
        Guid.NewGuid(), "usgs-topo", "USGS", "https://tiles.example/{z}/{y}/{x}", null, null,
        "USGS The National Map", 16, new TileCachePolicyDto(86400, true), "usgs-raster");

    private static RasterXyzFetcher FetcherAnswering(Func<HttpResponseMessage> answer) =>
        new(new HttpClient(new StubHandler(answer)), new FixedClock(Now));

    [Fact]
    public async Task A_429_with_delay_seconds_is_throttled_with_that_delay()
    {
        var fetcher = FetcherAnswering(() =>
        {
            var res = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            res.Headers.Add("Retry-After", "7");
            return res;
        });

        var tile = await fetcher.FetchAsync(Source, 3, 2, 1, CancellationToken.None);

        Assert.NotNull(tile);
        Assert.Equal(429, tile.ThrottledStatus);
        Assert.Equal(TimeSpan.FromSeconds(7), tile.RetryAfter);
        Assert.Empty(tile.Bytes);
    }

    [Fact]
    public async Task A_503_with_an_http_date_is_throttled_until_that_date()
    {
        var fetcher = FetcherAnswering(() =>
        {
            var res = new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
            res.Headers.Add("Retry-After", Now.AddSeconds(30).ToString("R"));
            return res;
        });

        var tile = await fetcher.FetchAsync(Source, 3, 2, 1, CancellationToken.None);

        Assert.Equal(503, tile?.ThrottledStatus);
        Assert.Equal(TimeSpan.FromSeconds(30), tile?.RetryAfter);
    }

    [Fact]
    public async Task A_429_without_retry_after_is_throttled_with_no_delay_given()
    {
        var fetcher = FetcherAnswering(() => new HttpResponseMessage(HttpStatusCode.TooManyRequests));

        var tile = await fetcher.FetchAsync(Source, 3, 2, 1, CancellationToken.None);

        Assert.Equal(429, tile?.ThrottledStatus);
        Assert.Null(tile?.RetryAfter);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task Other_failures_stay_a_plain_upstream_failure(HttpStatusCode status)
    {
        var fetcher = FetcherAnswering(() => new HttpResponseMessage(status));

        Assert.Null(await fetcher.FetchAsync(Source, 3, 2, 1, CancellationToken.None));
    }

    [Fact]
    public async Task The_service_passes_the_throttle_on_rounded_up_and_caches_nothing()
    {
        var cache = new TileCache(_root);
        var service = new TileService(
            [new ThrottlingFetcher(TimeSpan.FromSeconds(4.2))],
            new OneSource(Source),
            cache);

        var result = await service.GetTileAsync("usgs-topo", 3, 2, 1);

        Assert.Equal(TileStatus.UpstreamThrottled, result.Status);
        Assert.Equal(429, result.ThrottledStatus);
        // Rounded up: "4" would let a client retry 0.2 s inside the window.
        Assert.Equal(5, result.RetryAfterSeconds);
        Assert.False(cache.TryGet("usgs-topo", 3, 2, 1, out _, out _));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private sealed class StubHandler(Func<HttpResponseMessage> answer) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(answer());
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class ThrottlingFetcher(TimeSpan retryAfter) : ITileFetcher
    {
        public bool CanHandle(string kind) => true;

        public Task<FetchedTile?> FetchAsync(TileSourceResponse source, int z, int x, int y, CancellationToken ct) =>
            Task.FromResult<FetchedTile?>(FetchedTile.Throttled(429, retryAfter));
    }

    private sealed class OneSource(TileSourceResponse source) : ITileSourceService
    {
        public Task<TileSourceResponse?> GetByKeyAsync(string key, CancellationToken ct = default) =>
            Task.FromResult<TileSourceResponse?>(key == source.Key ? source : null);

        public Task<TileSourceResponse> CreateAsync(CreateTileSourceRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<TileSourceResponse>> ListAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<TileSourceResponse?> GetAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<TileSourceResponse?> UpdateAsync(Guid id, UpdateTileSourceRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> DeleteAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
    }
}

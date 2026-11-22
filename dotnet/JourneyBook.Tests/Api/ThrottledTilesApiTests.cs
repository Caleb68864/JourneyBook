using System.Net;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.Tiles;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace JourneyBook.Tests.Api;

/// <summary>
/// The tile proxy passes an upstream's "busy" on as the upstream said it: its status (429 here)
/// and its Retry-After. It used to answer a bare 502 for every upstream non-2xx, which hid the
/// window from the render worker (which honours Retry-After) and from browsers.
/// </summary>
public class ThrottledTilesApiTests(ThrottledTilesApiFactory factory) : IClassFixture<ThrottledTilesApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task An_upstream_429_reaches_the_caller_with_its_retry_after()
    {
        var res = await _client.GetAsync("/api/tiles/usgs-topo/5/9/12");

        Assert.Equal(HttpStatusCode.TooManyRequests, res.StatusCode);
        Assert.Equal(TimeSpan.FromSeconds(12), res.Headers.RetryAfter?.Delta);
        // A throttle is not a tile: nothing cacheable, no tile headers.
        Assert.False(res.Headers.Contains("X-Cache"));
        Assert.Null(res.Headers.ETag);
    }

    [Fact]
    public async Task A_throttle_is_not_cached_so_the_next_request_asks_again()
    {
        await _client.GetAsync("/api/tiles/usgs-topo/6/9/12");
        var again = await _client.GetAsync("/api/tiles/usgs-topo/6/9/12");

        Assert.Equal(HttpStatusCode.TooManyRequests, again.StatusCode);
        Assert.False(Directory.Exists(Path.Combine(factory.CacheDir, "usgs-topo", "6")));
    }
}

/// <summary><see cref="TilesApiFactory"/> with an upstream that always throttles for 12 s.</summary>
public class ThrottledTilesApiFactory : TilesApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ITileFetcher>();
            services.AddSingleton<ITileFetcher, AlwaysThrottlingFetcher>();
        });
    }
}

public sealed class AlwaysThrottlingFetcher : ITileFetcher
{
    public bool CanHandle(string kind) => kind is "usgs-raster" or "xyz-server";

    public Task<FetchedTile?> FetchAsync(TileSourceResponse source, int z, int x, int y, CancellationToken ct) =>
        Task.FromResult<FetchedTile?>(FetchedTile.Throttled(429, TimeSpan.FromSeconds(12)));
}

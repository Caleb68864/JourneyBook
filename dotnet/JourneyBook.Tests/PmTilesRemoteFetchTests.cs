using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using JourneyBook.Application.TileSources;
using JourneyBook.Infrastructure.Tiles;
using Microsoft.Extensions.Configuration;

namespace JourneyBook.Tests;

/// <summary>
/// A <c>pmtiles</c> row whose archive is a URL, read over HTTP ranges, against the shared raster
/// fixture served by a stub handler. Two things it used to get wrong: a throttled range request
/// was a bare 502 (the raster fetcher passes 429/503 and Retry-After on; this did not), and a
/// host that ignores <c>Range</c> and answers 200 with the whole file had its first bytes read as
/// if they were the requested offset, so every tile came back corrupt or missing.
/// </summary>
public class PmTilesRemoteFetchTests
{
    private static readonly byte[] Archive =
        File.ReadAllBytes(Path.Combine(RasterPackageFixtureTests.FixtureDir(), "package.pmtiles"));

    private static TileSourceResponse Row() => new(
        Guid.NewGuid(), "remote-pkg", "test", "https://packages.example/package.pmtiles", null, null,
        "USGS The National Map", 16, new TileCachePolicyDto(86400, true), "pmtiles");

    private static PmTilesFetcher FetcherFor(Func<HttpRequestMessage, HttpResponseMessage> answer) =>
        new(new HttpClient(new StubHandler(answer)), new ConfigurationBuilder().Build());

    private static HttpResponseMessage Ranged(HttpRequestMessage req)
    {
        var range = req.Headers.Range!.Ranges.Single();
        var from = (int)range.From!.Value;
        var to = (int)Math.Min(range.To!.Value, Archive.Length - 1);
        var res = new HttpResponseMessage(HttpStatusCode.PartialContent)
        {
            Content = new ByteArrayContent(Archive[from..(to + 1)]),
        };
        res.Content.Headers.ContentRange = new ContentRangeHeaderValue(from, to, Archive.Length);
        return res;
    }

    private static HttpResponseMessage WholeFile(HttpRequestMessage _) =>
        new(HttpStatusCode.OK) { Content = new ByteArrayContent(Archive) };

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    [Fact]
    public async Task Control_a_ranged_host_serves_every_packaged_tile()
    {
        var fetcher = FetcherFor(Ranged);
        foreach (var t in RasterPackageFixtureTests.LoadManifest().Tiles)
        {
            var tile = await fetcher.FetchAsync(Row(), t.Z, t.X, t.Y, CancellationToken.None);
            Assert.True(tile is { Empty: false }, $"{t.Z}/{t.X}/{t.Y} not served");
            Assert.Equal(t.Sha256, Sha(tile!.Bytes));
        }
    }

    [Fact]
    public async Task A_host_that_ignores_range_still_serves_the_right_tiles()
    {
        var fetcher = FetcherFor(WholeFile);
        foreach (var t in RasterPackageFixtureTests.LoadManifest().Tiles)
        {
            var tile = await fetcher.FetchAsync(Row(), t.Z, t.X, t.Y, CancellationToken.None);
            Assert.True(tile is { Empty: false }, $"{t.Z}/{t.X}/{t.Y} not served");
            Assert.Equal(t.Sha256, Sha(tile!.Bytes));
        }
    }

    /// <summary>
    /// A large archive on a host that ignores Range is refused from the headers alone: fetching it
    /// whole on every read would move gigabytes per tile (and past 2 GB the buffer throws).
    /// </summary>
    [Fact]
    public async Task A_large_archive_on_a_host_that_ignores_range_is_refused_before_its_body_is_read()
    {
        var bodyRead = false;
        var fetcher = FetcherFor(_ =>
        {
            var content = new ByteArrayContent(Archive);
            content.Headers.ContentLength = HttpRangeStream.MaxWholeFileBytes + 1;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ReadWatchingContent(content, () => bodyRead = true) };
        });
        var t = RasterPackageFixtureTests.LoadManifest().Tiles[0];

        Assert.Null(await fetcher.FetchAsync(Row(), t.Z, t.X, t.Y, CancellationToken.None));
        Assert.False(bodyRead, "the whole oversized body was buffered before being refused");
    }

    /// <summary>Content that records whether anything read its body.</summary>
    private sealed class ReadWatchingContent(HttpContent inner, Action onRead) : HttpContent
    {
        protected override async Task SerializeToStreamAsync(Stream stream, System.Net.TransportContext? context)
        {
            onRead();
            await inner.CopyToAsync(stream);
        }

        protected override bool TryComputeLength(out long length)
        {
            length = inner.Headers.ContentLength ?? 0;
            return inner.Headers.ContentLength is not null;
        }
    }

    [Fact]
    public async Task A_throttled_range_request_is_passed_on_with_its_retry_after()
    {
        var fetcher = FetcherFor(_ =>
        {
            var res = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            res.Headers.Add("Retry-After", "9");
            return res;
        });
        var t = RasterPackageFixtureTests.LoadManifest().Tiles[0];

        var tile = await fetcher.FetchAsync(Row(), t.Z, t.X, t.Y, CancellationToken.None);

        Assert.Equal(429, tile?.ThrottledStatus);
        Assert.Equal(TimeSpan.FromSeconds(9), tile?.RetryAfter);
    }

    [Fact]
    public async Task Control_a_broken_host_is_still_a_plain_upstream_failure()
    {
        var fetcher = FetcherFor(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var t = RasterPackageFixtureTests.LoadManifest().Tiles[0];

        Assert.Null(await fetcher.FetchAsync(Row(), t.Z, t.X, t.Y, CancellationToken.None));
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(answer(request));
    }
}

using System.Net;
using JourneyBook.Application.TileSources;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Fetches raster XYZ tiles by literal <c>{z}</c>/<c>{x}</c>/<c>{y}</c> token replacement on the
/// source's stored URL template. Ordering is encoded in the template itself (USGS ArcGIS stores
/// <c>{z}/{y}/{x}</c>), so <c>usgs-raster</c> and <c>xyz-server</c> share one fetcher with no
/// per-provider special-casing. A 429 or 503 comes back as <see cref="FetchedTile.Throttled"/>
/// with the source's <c>Retry-After</c>; any other non-2xx, timeout, or transport error returns
/// <c>null</c> (→ 502). Failures are never cached.
/// </summary>
public sealed class RasterXyzFetcher : ITileFetcher
{
    private readonly HttpClient http;

    private readonly TimeProvider clock;

    // One constructor, the clock optional: a typed HttpClient is built by ActivatorUtilities,
    // and two public constructors it can satisfy make that activation ambiguous (a 500 on
    // every tile request). Tests pass a fixed clock to read an HTTP-date Retry-After.
    public RasterXyzFetcher(HttpClient http, TimeProvider? clock = null)
    {
        this.http = http;
        this.clock = clock ?? TimeProvider.System;
    }

    public bool CanHandle(string kind) => kind is "usgs-raster" or "xyz-server";

    public async Task<FetchedTile?> FetchAsync(TileSourceResponse source, int z, int x, int y, CancellationToken ct)
    {
        var url = source.SourceUrl
            .Replace("{z}", z.ToString())
            .Replace("{x}", x.ToString())
            .Replace("{y}", y.ToString());

        try
        {
            using var res = await http.GetAsync(url, ct);
            if (res.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable)
            {
                return FetchedTile.Throttled((int)res.StatusCode, RetryAfterOf(res));
            }

            if (!res.IsSuccessStatusCode)
            {
                return null;
            }

            var bytes = await res.Content.ReadAsByteArrayAsync(ct);
            var contentType = res.Content.Headers.ContentType?.MediaType ?? "image/png";
            return new FetchedTile(bytes, contentType, Empty: false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // HttpClient.Timeout elapsed (surfaces as a cancellation not tied to our token).
            return null;
        }
        catch (Exception)
        {
            // Any other upstream/transport failure (HttpRequestException, IOException,
            // socket errors, etc.) ⇒ null so the service surfaces a 502; never cached.
            return null;
        }
    }

    /// <summary>
    /// The response's <c>Retry-After</c> as a delay: delay-seconds as given, an HTTP-date as the
    /// time left until it (a past date is zero). Null when the header is absent.
    /// </summary>
    private TimeSpan? RetryAfterOf(HttpResponseMessage res)
    {
        var header = res.Headers.RetryAfter;
        if (header?.Delta is { } delta)
        {
            return delta;
        }

        if (header?.Date is { } date)
        {
            var left = date - clock.GetUtcNow();
            return left > TimeSpan.Zero ? left : TimeSpan.Zero;
        }

        return null;
    }
}

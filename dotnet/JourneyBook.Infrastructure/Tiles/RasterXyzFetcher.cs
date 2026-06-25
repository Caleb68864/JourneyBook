using JourneyBook.Application.TileSources;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Fetches raster XYZ tiles by literal <c>{z}</c>/<c>{x}</c>/<c>{y}</c> token replacement on the
/// source's stored URL template. Ordering is encoded in the template itself (USGS ArcGIS stores
/// <c>{z}/{y}/{x}</c>), so <c>usgs-raster</c> and <c>xyz-server</c> share one fetcher with no
/// per-provider special-casing. Any non-2xx, timeout, or transport error returns <c>null</c>
/// (→ 502); failures are never cached.
/// </summary>
public sealed class RasterXyzFetcher : ITileFetcher
{
    private readonly HttpClient http;

    public RasterXyzFetcher(HttpClient http)
    {
        this.http = http;
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
}

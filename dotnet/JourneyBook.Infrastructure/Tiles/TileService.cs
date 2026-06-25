using System.Security.Cryptography;
using JourneyBook.Application.TileSources;
using JourneyBook.Application.Tiles;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Orchestrates tile serving over the Stage 2D registry + disk cache: resolve the source by key,
/// validate zoom against the source MaxZoom, check the cache, dispatch to the fetcher whose
/// <see cref="ITileFetcher.CanHandle"/> matches the source <c>Kind</c> on a miss, then store +
/// return. Attribution is read fresh from the registry row on every call (never from cached bytes);
/// a source with no attribution is refused.
/// </summary>
public sealed class TileService(
    IEnumerable<ITileFetcher> fetchers,
    ITileSourceService sources,
    TileCache cache) : ITileService
{
    public async Task<TileResult> GetTileAsync(string sourceKey, int z, int x, int y, CancellationToken ct = default)
    {
        var source = await sources.GetByKeyAsync(sourceKey, ct);
        if (source is null)
        {
            return TileResult.UnknownSource();
        }

        if (z > source.MaxZoom)
        {
            return TileResult.ZoomOutOfRange();
        }

        if (string.IsNullOrWhiteSpace(source.Attribution))
        {
            throw new InvalidOperationException($"Tile source '{sourceKey}' has no attribution; refusing to serve.");
        }

        var fetcher = fetchers.FirstOrDefault(f => f.CanHandle(source.Kind))
            ?? throw new NotSupportedException($"No tile fetcher handles kind '{source.Kind}'.");

        // Cache lookup discovers whichever ext was stored (png/pbf/…), so a HIT works for raster
        // and PMTiles alike without knowing the content-type up front.
        if (cache.TryGet(sourceKey, z, x, y, out var cached, out var cachedExt))
        {
            return new TileResult(TileStatus.Ok, cached, ContentTypeFor(cachedExt), source.Attribution, Etag(cached), CacheHit: true);
        }

        var fetched = await fetcher.FetchAsync(source, z, x, y, ct);
        if (fetched is null)
        {
            return TileResult.UpstreamError(); // nothing cached
        }

        if (fetched.Empty)
        {
            return TileResult.EmptyTile(source.Attribution);
        }

        cache.Store(sourceKey, z, x, y, ExtFor(fetched.ContentType), fetched.Bytes);
        return new TileResult(TileStatus.Ok, fetched.Bytes, fetched.ContentType, source.Attribution, Etag(fetched.Bytes), CacheHit: false);
    }

    private static string Etag(byte[] bytes) => "\"" + Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() + "\"";

    private static string ExtFor(string contentType) => contentType switch
    {
        "application/x-protobuf" or "application/vnd.mapbox-vector-tile" => "pbf",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };

    private static string ContentTypeFor(string ext) => ext switch
    {
        "pbf" => "application/x-protobuf",
        "jpg" or "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };
}

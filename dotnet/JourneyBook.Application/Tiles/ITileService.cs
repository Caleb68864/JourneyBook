namespace JourneyBook.Application.Tiles;

/// <summary>Outcome of a tile request, mapped by the HTTP layer to a status code.</summary>
public enum TileStatus
{
    Ok,             // 200 — serve Bytes
    Empty,          // 204 — valid sparse miss (e.g. PMTiles tile absent)
    UnknownSource,  // 404 — no registry row for the key
    ZoomOutOfRange, // 400 — z exceeds the source's MaxZoom
    UpstreamError,  // 502 — fetch failed (network/timeout/non-2xx/corrupt archive)
}

/// <summary>
/// One resolved map tile plus the metadata the HTTP layer needs. Only <c>Status == Ok</c> carries
/// real <c>Bytes</c>/<c>ETag</c>; other statuses map straight to their HTTP code.
/// </summary>
public record TileResult(
    TileStatus Status,
    byte[] Bytes,
    string ContentType,
    string Attribution,
    string ETag,
    bool CacheHit)
{
    public static TileResult UnknownSource() => new(TileStatus.UnknownSource, [], "", "", "", false);
    public static TileResult ZoomOutOfRange() => new(TileStatus.ZoomOutOfRange, [], "", "", "", false);
    public static TileResult UpstreamError() => new(TileStatus.UpstreamError, [], "", "", "", false);
    public static TileResult EmptyTile(string attribution) => new(TileStatus.Empty, [], "", attribution, "", false);
}

/// <summary>
/// Resolves a single map tile for a registered <c>TileSource</c>: registry lookup → disk-cache
/// check → dispatch to the right fetcher on a miss → cache + return. Never returns null; the
/// outcome is carried by <see cref="TileResult.Status"/>.
/// </summary>
public interface ITileService
{
    Task<TileResult> GetTileAsync(string sourceKey, int z, int x, int y, CancellationToken ct = default);
}

using JourneyBook.Application.TileSources;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Bytes fetched from upstream plus their content-type. <c>Empty</c> marks a sparse miss.
/// <c>ThrottledStatus</c> (429 or 503, with no bytes) marks an upstream that said "busy, come
/// back later", with its <c>Retry-After</c> when it sent one; see <see cref="Throttled"/>.
/// </summary>
public record FetchedTile(
    byte[] Bytes,
    string ContentType,
    bool Empty,
    int? ThrottledStatus = null,
    TimeSpan? RetryAfter = null)
{
    /// <summary>
    /// The upstream throttled this request. Kept apart from a plain failure (<c>null</c>, which
    /// becomes 502) so the proxy can pass the status and the source's <c>Retry-After</c> on to
    /// its own caller: the render worker honours <c>Retry-After</c>, and a bare 502 hid it.
    /// </summary>
    public static FetchedTile Throttled(int status, TimeSpan? retryAfter) =>
        new([], "", Empty: false, ThrottledStatus: status, RetryAfter: retryAfter);
}

/// <summary>
/// Fetches a single tile for a given source kind. Implementations return <c>null</c> on an
/// upstream failure (network/timeout/non-2xx/corrupt archive) — the service surfaces that as 502.
/// A valid-but-absent tile is signalled with <see cref="FetchedTile.Empty"/> = true (→ 204).
/// </summary>
public interface ITileFetcher
{
    bool CanHandle(string kind);

    Task<FetchedTile?> FetchAsync(TileSourceResponse source, int z, int x, int y, CancellationToken ct);
}

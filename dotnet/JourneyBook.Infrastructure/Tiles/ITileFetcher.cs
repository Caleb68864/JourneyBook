using JourneyBook.Application.TileSources;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>Bytes fetched from upstream plus their content-type. <c>Empty</c> marks a sparse miss.</summary>
public record FetchedTile(byte[] Bytes, string ContentType, bool Empty);

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

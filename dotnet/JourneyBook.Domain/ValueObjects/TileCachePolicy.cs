namespace JourneyBook.Domain.ValueObjects;

/// <summary>
/// Caching/terms policy carried with a tile source so attribution and offline
/// rules travel with any cached bytes. Owned by <see cref="Entities.TileSource"/>.
/// Mirrors the TS <c>TileCachePolicy</c> in <c>@journeybook/map-sources</c>.
/// </summary>
public class TileCachePolicy
{
    /// <summary>Seconds a browser/device may cache a tile response.</summary>
    public int MaxAgeSeconds { get; set; }

    /// <summary>Whether the source permits building offline/extracted packages.</summary>
    public bool OfflineAllowed { get; set; }
}

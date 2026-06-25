using JourneyBook.Domain.Common;
using JourneyBook.Domain.ValueObjects;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// A registered map tile/vector source with its attribution and cache policy.
/// Global registry (not project-scoped).
/// </summary>
public class TileSource : EntityBase
{
    /// <summary>Stable slug, e.g. "protomaps-basemap". Unique.</summary>
    public required string Key { get; set; }

    public required string Provider { get; set; }
    public required string SourceUrl { get; set; }

    /// <summary>
    /// Dispatch discriminator for the tile proxy: <c>usgs-raster</c> | <c>xyz-server</c> |
    /// <c>pmtiles</c>. Defaults to <c>usgs-raster</c>; existing rows backfill to that value.
    /// </summary>
    public string Kind { get; set; } = "usgs-raster";

    public string? Version { get; set; }
    public DateOnly? SourceDate { get; set; }

    /// <summary>Required attribution, e.g. "© OpenStreetMap contributors".</summary>
    public required string Attribution { get; set; }

    public int MaxZoom { get; set; }

    /// <summary>Owned cache/terms policy.</summary>
    public TileCachePolicy Cache { get; set; } = new();
}

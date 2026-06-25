using JourneyBook.Domain.Common;
using NetTopologySuite.Geometries;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// A user-added place that matters — Grandma's house, school, a trailhead.
/// Can generate its own fixed-scale location page (Stage 2C).
/// </summary>
public class ImportantLocation : EntityBase
{
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }

    public required string Name { get; set; }

    /// <summary>Position in WGS84 (SRID 4326).</summary>
    public required Point Location { get; set; }

    public LocationCategory Category { get; set; } = LocationCategory.Other;

    public string? Notes { get; set; }

    public SourceConfidence SourceConfidence { get; set; } = SourceConfidence.Unknown;

    /// <summary>
    /// Optional per-location scale preset id (e.g. "usgs-7-5-min"), overriding the
    /// project scale so this location's page can zoom in. Null → use the project scale.
    /// </summary>
    public string? ScalePresetId { get; set; }

    // --- Geocode-search planning (UI deferred to Stage 9) -----------------
    /// <summary>Original query/text the position was geocoded from, if any.</summary>
    public string? GeocodedFrom { get; set; }

    /// <summary>Geocoder that produced the position (e.g. "nominatim"), if any.</summary>
    public string? GeocodeProvider { get; set; }

    /// <summary>L-series number assigned within the project (e.g. L1, L2 …).</summary>
    public int LocationNumber { get; set; }
}

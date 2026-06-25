using JourneyBook.Domain.Common;
using NetTopologySuite.Geometries;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// An OSM-sourced point of interest imported via the landmark pipeline.
/// </summary>
public class Landmark : EntityBase
{
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }

    public required string Name { get; set; }

    /// <summary>Position in WGS84 (SRID 4326).</summary>
    public required Point Location { get; set; }

    public LandmarkCategory Category { get; set; } = LandmarkCategory.Other;

    /// <summary>Relevance score used for density culling (higher = more prominent).</summary>
    public double Score { get; set; }

    /// <summary>Raw OSM tags from which this landmark was derived.</summary>
    public Dictionary<string, string> SourceTags { get; set; } = [];
}

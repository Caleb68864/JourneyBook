using JourneyBook.Domain.Common;
using NetTopologySuite.Geometries;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// The geographic extent of a project's atlas, as a WGS84 (SRID 4326) polygon.
/// One-to-one with <see cref="Project"/>.
/// </summary>
public class AtlasExtent : EntityBase
{
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }

    /// <summary>Bounding polygon in WGS84 (SRID 4326).</summary>
    public required Polygon Bounds { get; set; }
}

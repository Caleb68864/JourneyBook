using JourneyBook.Domain.Common;
using NetTopologySuite.Geometries;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// A single sheet in the page grid. Derived/persisted by the engine (Stage 1B/3);
/// the table exists from Stage 2A so derivation has somewhere to write.
/// </summary>
public class AtlasPage : EntityBase
{
    public Guid PageGridId { get; set; }
    public AtlasPageGrid? PageGrid { get; set; }

    /// <summary>Grid id such as "A1", "B2", or a location id such as "L1".</summary>
    public required string Label { get; set; }

    public int Row { get; set; }
    public int Column { get; set; }

    // Neighbor page labels (null when this page is on an edge).
    public string? NeighborNorth { get; set; }
    public string? NeighborSouth { get; set; }
    public string? NeighborEast { get; set; }
    public string? NeighborWest { get; set; }

    /// <summary>Printable extent of this page in WGS84 (SRID 4326).</summary>
    public required Polygon Bounds { get; set; }
}

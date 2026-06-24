using JourneyBook.Domain.Common;
using JourneyBook.Domain.ValueObjects;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// Page-grid metadata for a project: dimensions, orientation, scale, margins,
/// and overlap. The derived individual pages live in <see cref="Pages"/>.
/// One-to-one with <see cref="Project"/>.
/// </summary>
public class AtlasPageGrid : EntityBase
{
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }

    /// <summary>Chosen scale preset (e.g. "usgs-7-5-min").</summary>
    public required string ScalePresetId { get; set; }
    public ScalePreset? ScalePreset { get; set; }

    public PageOrientation Orientation { get; set; } = PageOrientation.Portrait;

    public int Rows { get; set; }
    public int Columns { get; set; }

    /// <summary>Fractional page overlap (e.g. 0.05 = 5%).</summary>
    public double Overlap { get; set; }

    /// <summary>Owned safe margins (inches) + optional binder gutter.</summary>
    public PageMargins Margins { get; set; } = new();

    public ICollection<AtlasPage> Pages { get; set; } = [];
}

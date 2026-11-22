using JourneyBook.Domain.Common;

namespace JourneyBook.Domain.Entities;

/// <summary>Column limits, shared by the EF model and the request validation.</summary>
public static class ProjectLimits
{
    public const int ExplorerNameMaxLength = 120;
    public const int AtlasDateMaxLength = 60;
    public const int MaxWorksheetLegs = 50;
    public const int WorksheetLegRefMaxLength = 210;
}

/// <summary>
/// An atlas project — the root the user creates and reopens. Single-user MVP:
/// no owner column yet (the aggregate is shaped so one can be added later).
/// </summary>
public class Project : EntityBase
{
    public required string Name { get; set; }

    /// <summary>Printed on the book's title page. Null prints no such line.</summary>
    public string? ExplorerName { get; set; }

    /// <summary>Free text ("Summer 2026") printed on the title page as given; not a timestamp.</summary>
    public string? AtlasDate { get; set; }

    /// <summary>
    /// Hand-picked worksheet legs, kept by place, not position: each end is "loc:&lt;location id&gt;"
    /// or "lm:&lt;landmark name&gt;", so deleting a location drops its legs instead of rebinding
    /// "L3" to another place. Empty by default.
    /// </summary>
    public List<WorksheetLegRef> WorksheetLegs { get; set; } = [];

    /// <summary>The editor's map tier (1–4); null until chosen, when the editor's default applies.</summary>
    public int? MapTier { get; set; }

    /// <summary>The editor's Azimuth Worksheet switch (used only at tier 4).</summary>
    public bool Worksheet { get; set; }

    /// <summary>The editor's "Legs To Nearby Landmarks" switch (used only with landmarks included).</summary>
    public bool WorksheetLandmarks { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    // One-to-one
    public AtlasExtent? Extent { get; set; }
    public AtlasPageGrid? PageGrid { get; set; }

    // One-to-many
    public ICollection<ImportantLocation> Locations { get; set; } = [];
    public ICollection<Landmark> Landmarks { get; set; } = [];
    public ICollection<GeneratedPdf> GeneratedPdfs { get; set; } = [];
}

/// <summary>One saved worksheet leg's two ends (see <see cref="Project.WorksheetLegs"/>).</summary>
public sealed record WorksheetLegRef(string From, string To);

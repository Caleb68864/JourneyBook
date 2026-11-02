using JourneyBook.Domain.Common;

namespace JourneyBook.Domain.Entities;

/// <summary>Column limits, shared by the EF model and the request validation.</summary>
public static class ProjectLimits
{
    public const int ExplorerNameMaxLength = 120;
    public const int AtlasDateMaxLength = 60;
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

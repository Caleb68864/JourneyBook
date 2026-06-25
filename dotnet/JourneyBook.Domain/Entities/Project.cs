using JourneyBook.Domain.Common;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// An atlas project — the root the user creates and reopens. Single-user MVP:
/// no owner column yet (the aggregate is shaped so one can be added later).
/// </summary>
public class Project : EntityBase
{
    public required string Name { get; set; }

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

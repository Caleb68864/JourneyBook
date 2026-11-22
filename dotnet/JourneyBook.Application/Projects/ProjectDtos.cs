using JourneyBook.Application.Common;

namespace JourneyBook.Application.Projects;

/// <summary>Safe margins (inches) + optional binder gutter.</summary>
public record MarginsDto(double Top, double Right, double Bottom, double Left, double Gutter = 0);


public record CreateProjectRequest(
    string Name,
    string ScalePresetId,
    string Orientation = "Portrait",
    double Overlap = 0,
    MarginsDto? Margins = null,
    string? ExplorerName = null,
    string? AtlasDate = null);

public record UpdateProjectRequest(
    string Name,
    string ScalePresetId,
    string Orientation,
    double Overlap,
    MarginsDto Margins,
    string? ExplorerName = null,
    string? AtlasDate = null,
    // Saved worksheet legs ("loc:<id>" / "lm:<name>" ends). Null leaves them as they are, so a
    // client that does not know the field cannot wipe them; an empty list clears them.
    IReadOnlyList<WorksheetLegDto>? WorksheetLegs = null);

/// <summary>A saved worksheet leg: each end "loc:&lt;location id&gt;" or "lm:&lt;landmark name&gt;".</summary>
public record WorksheetLegDto(string From, string To);

public record ProjectResponse(
    Guid Id,
    string Name,
    string ScalePresetId,
    string Orientation,
    double Overlap,
    MarginsDto Margins,
    BBoxDto? Extent,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? ExplorerName = null,
    string? AtlasDate = null,
    IReadOnlyList<WorksheetLegDto>? WorksheetLegs = null);

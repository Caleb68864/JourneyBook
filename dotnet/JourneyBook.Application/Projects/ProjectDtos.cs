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
    string? AtlasDate = null);

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
    string? AtlasDate = null);

namespace JourneyBook.Application.Projects;

/// <summary>Safe margins (inches) + optional binder gutter.</summary>
public record MarginsDto(double Top, double Right, double Bottom, double Left, double Gutter = 0);

/// <summary>WGS84 bounding box [west, south, east, north] in degrees.</summary>
public record BBoxDto(double West, double South, double East, double North);

public record CreateProjectRequest(
    string Name,
    string ScalePresetId,
    string Orientation = "Portrait",
    double Overlap = 0,
    MarginsDto? Margins = null);

public record UpdateProjectRequest(
    string Name,
    string ScalePresetId,
    string Orientation,
    double Overlap,
    MarginsDto Margins);

public record ProjectResponse(
    Guid Id,
    string Name,
    string ScalePresetId,
    string Orientation,
    double Overlap,
    MarginsDto Margins,
    BBoxDto? Extent,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

namespace JourneyBook.Application.Locations;

/// <summary>
/// Create an important location within a project. <c>Category</c> and
/// <c>SourceConfidence</c> are parsed (case-insensitively) against the
/// <c>LocationCategory</c> / <c>SourceConfidence</c> domain enums.
/// </summary>
public record CreateLocationRequest(
    string Name,
    double Lng,
    double Lat,
    string Category = "Other",
    string? Notes = null,
    string SourceConfidence = "Unknown");

/// <summary>Replace the mutable fields of an existing important location.</summary>
public record UpdateLocationRequest(
    string Name,
    double Lng,
    double Lat,
    string Category,
    string? Notes,
    string SourceConfidence);

/// <summary>
/// An important location with its stable L-series label.
/// <c>Label = $"L{LocationNumber}"</c> and
/// <c>ReferenceLabel = $"see page L{LocationNumber}"</c>.
/// </summary>
public record LocationResponse(
    Guid Id,
    Guid ProjectId,
    string Name,
    double Lng,
    double Lat,
    string Category,
    string? Notes,
    string SourceConfidence,
    int LocationNumber,
    string Label,
    string ReferenceLabel,
    string? GeocodedFrom,
    string? GeocodeProvider);

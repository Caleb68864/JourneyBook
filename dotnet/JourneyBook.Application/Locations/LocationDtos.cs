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
    string SourceConfidence = "Unknown",
    string? ScalePresetId = null);

/// <summary>
/// Bulk-import locations from CSV text. Header row required; columns
/// (case-insensitive): <c>name</c>, <c>lng</c>|<c>longitude</c>, <c>lat</c>|
/// <c>latitude</c> (required); <c>notes</c>, <c>scale</c>|<c>scalePresetId</c>
/// (optional). All-or-nothing: any invalid row rejects the whole import (400).
/// </summary>
public record ImportLocationsRequest(string Csv);

/// <summary>Result of a CSV import: the created locations and their count.</summary>
public record ImportLocationsResponse(int Imported, IReadOnlyList<LocationResponse> Locations);

/// <summary>Replace the mutable fields of an existing important location.</summary>
public record UpdateLocationRequest(
    string Name,
    double Lng,
    double Lat,
    string Category,
    string? Notes,
    string SourceConfidence,
    string? ScalePresetId = null);

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
    string? GeocodeProvider,
    string? ScalePresetId);

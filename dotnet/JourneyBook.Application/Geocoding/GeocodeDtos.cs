namespace JourneyBook.Application.Geocoding;

/// <summary>
/// A single geocode candidate: a human-readable place plus its WGS84 position.
/// <c>Type</c>/<c>Category</c> carry the provider's classification (e.g. "city",
/// "house") for display only.
/// </summary>
public record GeocodeResultDto(string DisplayName, double Lat, double Lng, string? Type = null, string? Category = null);

using JourneyBook.Application.Rendering;

namespace JourneyBook.Application.Geocoding;

/// <summary>
/// Forward-geocodes a free-text address/place query to candidate WGS84 positions
/// (Nominatim or a compatible provider). An optional <paramref name="viewbox"/>
/// biases results toward a project's extent. Implementations degrade gracefully:
/// a network, timeout, HTTP, or parse failure yields an empty list rather than
/// throwing, so a search never fails the request on the geocoder being unavailable.
/// </summary>
public interface IGeocodeClient
{
    Task<IReadOnlyList<GeocodeResultDto>> SearchAsync(
        string query,
        RenderBBoxDto? viewbox = null,
        CancellationToken ct = default);
}

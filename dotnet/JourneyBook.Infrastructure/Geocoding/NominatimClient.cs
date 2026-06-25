using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using JourneyBook.Application.Geocoding;
using JourneyBook.Application.Rendering;

namespace JourneyBook.Infrastructure.Geocoding;

/// <summary>
/// Typed <see cref="HttpClient"/> implementation of <see cref="IGeocodeClient"/> backed
/// by a Nominatim-compatible search endpoint (default the public OSM Nominatim). Builds a
/// <c>/search</c> request for the query, optionally biased to a project's extent via the
/// <c>viewbox</c> parameter. Degrades gracefully: any network, timeout, HTTP, or parse
/// failure yields an empty list rather than throwing.
/// </summary>
/// <remarks>
/// The public Nominatim usage policy requires a descriptive <c>User-Agent</c> (set in DI)
/// and tolerates light, occasional use — appropriate for single-user MVP search. Point the
/// base URL at a self-hosted Nominatim to remove the policy/rate constraints.
/// </remarks>
public class NominatimClient(HttpClient http) : IGeocodeClient
{
    private const int MaxResults = 6;

    private static readonly JsonSerializerOptions s_readOptions =
        new() { PropertyNameCaseInsensitive = true };

    public async Task<IReadOnlyList<GeocodeResultDto>> SearchAsync(
        string query,
        RenderBBoxDto? viewbox = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return [];
        }

        try
        {
            var url = BuildUrl(query, viewbox);
            using var response = await http.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode)
            {
                // Graceful: a geocoder outage or rate-limit must not fail the search.
                return [];
            }

            var rows = await response.Content.ReadFromJsonAsync<List<NominatimPlace>>(s_readOptions, ct);
            if (rows is null)
            {
                return [];
            }

            var results = new List<GeocodeResultDto>(rows.Count);
            foreach (var row in rows)
            {
                // Nominatim serializes lat/lon as strings.
                if (row.DisplayName is null ||
                    !double.TryParse(row.Lat, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) ||
                    !double.TryParse(row.Lon, NumberStyles.Float, CultureInfo.InvariantCulture, out var lng))
                {
                    continue;
                }
                results.Add(new GeocodeResultDto(row.DisplayName, lat, lng, row.Type, row.Class));
            }

            return results;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return [];
        }
    }

    private static string BuildUrl(string query, RenderBBoxDto? viewbox)
    {
        var q = Uri.EscapeDataString(query.Trim());
        var url = $"/search?q={q}&format=jsonv2&addressdetails=0&limit={MaxResults}";
        if (viewbox is { } v)
        {
            // Nominatim viewbox order is <west>,<north>,<east>,<south>; bounded=0 biases
            // (prefers in-box results) rather than hard-filtering, so out-of-box matches
            // still return when nothing local fits.
            var inv = CultureInfo.InvariantCulture;
            var box = string.Join(",",
                v.West.ToString(inv), v.North.ToString(inv), v.East.ToString(inv), v.South.ToString(inv));
            url += $"&viewbox={box}&bounded=0";
        }
        return url;
    }

    /// <summary>A Nominatim <c>/search</c> result row (jsonv2). Lat/lon are strings.</summary>
    private sealed record NominatimPlace(
        [property: JsonPropertyName("display_name")] string? DisplayName,
        [property: JsonPropertyName("lat")] string? Lat,
        [property: JsonPropertyName("lon")] string? Lon,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("class")] string? Class);
}

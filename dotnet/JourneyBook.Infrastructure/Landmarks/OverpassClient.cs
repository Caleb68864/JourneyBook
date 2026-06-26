using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using JourneyBook.Application.Landmarks;
using JourneyBook.Application.Rendering;

namespace JourneyBook.Infrastructure.Landmarks;

/// <summary>
/// Typed <see cref="HttpClient"/> implementation of <see cref="IOverpassClient"/> that
/// POSTs an Overpass QL query to the OpenStreetMap Overpass API at the configured base
/// URL and returns the raw landmark points of interest within an extent.
/// </summary>
/// <remarks>
/// The query targets a curated tag set (the same families <c>LandmarkService</c> maps to
/// a <c>LandmarkCategory</c>) over the bounding box and asks for centre coordinates so
/// ways and relations resolve to a single point. Degrades gracefully: any network,
/// timeout, HTTP, or parse failure yields an empty list rather than throwing, so an
/// import never fails the request on Overpass being unavailable.
/// </remarks>
public class OverpassClient(HttpClient http) : IOverpassClient
{
    private static readonly JsonSerializerOptions s_readOptions =
        new() { PropertyNameCaseInsensitive = true };

    /// <summary>
    /// Curated OSM <c>key=value[|value...]</c> filters mirroring <c>LandmarkService</c>'s
    /// curated tag map. Each becomes an <c>nwr["key"~"^(values)$"](bbox);</c> clause.
    /// </summary>
    private static readonly (string Key, string Values)[] s_curatedFilters =
    [
        ("natural", "peak|water|spring"),
        ("water", "lake"),
        ("man_made", "tower|mast|water_tower"),
        ("amenity", "school|university|college|place_of_worship|townhall|courthouse|library|hospital|fire_station|police"),
        ("leisure", "park|nature_reserve"),
        ("boundary", "national_park"),
        ("tourism", "viewpoint|hotel|motel|camp_site"),
        ("highway", "trailhead|rest_area|services"),
        ("information", "trailhead"),
        ("railway", "station"),
        ("public_transport", "station"),
        // Road-trip services.
        ("amenity", "fuel|charging_station|restaurant|fast_food|cafe"),
    ];

    public async Task<IReadOnlyList<OverpassPoi>> QueryLandmarksAsync(RenderBBoxDto bbox, CancellationToken ct = default)
    {
        try
        {
            var query = BuildQuery(bbox);

            using var content = new StringContent(query, Encoding.UTF8, "text/plain");
            using var response = await http.PostAsync("/api/interpreter", content, ct);

            if (!response.IsSuccessStatusCode)
            {
                // Graceful: an Overpass outage or rate-limit must not fail the import.
                return [];
            }

            var result = await response.Content.ReadFromJsonAsync<OverpassResult>(s_readOptions, ct);
            if (result?.Elements is null)
            {
                return [];
            }

            var pois = new List<OverpassPoi>(result.Elements.Count);
            foreach (var element in result.Elements)
            {
                // Nodes carry lat/lon directly; ways/relations carry a `center`
                // (requested via `out center;`). Skip anything without a position.
                var lat = element.Lat ?? element.Center?.Lat;
                var lng = element.Lon ?? element.Center?.Lon;
                if (lat is null || lng is null)
                {
                    continue;
                }

                var tags = element.Tags ?? new Dictionary<string, string>();
                tags.TryGetValue("name", out var name);

                pois.Add(new OverpassPoi(lng.Value, lat.Value, name, tags));
            }

            return pois;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            // Network failure, timeout, or unparseable payload → empty (graceful).
            return [];
        }
    }

    /// <summary>
    /// Build an Overpass QL query for the curated tag set within <paramref name="bbox"/>.
    /// Overpass bounding boxes are <c>(south,west,north,east)</c>; <see cref="RenderBBoxDto"/>
    /// is <c>(West, South, East, North)</c>.
    /// </summary>
    private static string BuildQuery(RenderBBoxDto bbox)
    {
        var south = bbox.South.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var west = bbox.West.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var north = bbox.North.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var east = bbox.East.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var box = $"({south},{west},{north},{east})";

        var sb = new StringBuilder();
        sb.Append("[out:json][timeout:25];(");
        foreach (var (key, values) in s_curatedFilters)
        {
            sb.Append($"nwr[\"{key}\"~\"^({values})$\"]{box};");
        }
        sb.Append(");out center;");
        return sb.ToString();
    }

    /// <summary>Top-level Overpass JSON response: <c>{ "elements": [ ... ] }</c>.</summary>
    private sealed record OverpassResult(
        [property: JsonPropertyName("elements")] List<OverpassElement> Elements);

    /// <summary>
    /// A single Overpass element. Nodes expose <c>lat</c>/<c>lon</c>; ways and relations
    /// expose a <c>center</c> when queried with <c>out center;</c>.
    /// </summary>
    private sealed record OverpassElement(
        [property: JsonPropertyName("lat")] double? Lat,
        [property: JsonPropertyName("lon")] double? Lon,
        [property: JsonPropertyName("center")] OverpassCenter? Center,
        [property: JsonPropertyName("tags")] Dictionary<string, string>? Tags);

    /// <summary>Centroid of a way/relation from <c>out center;</c>.</summary>
    private sealed record OverpassCenter(
        [property: JsonPropertyName("lat")] double Lat,
        [property: JsonPropertyName("lon")] double Lon);
}

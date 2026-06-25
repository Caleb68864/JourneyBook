using JourneyBook.Application.Landmarks;
using JourneyBook.Domain;
using JourneyBook.Domain.Entities;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite;
using NetTopologySuite.Geometries;

namespace JourneyBook.Infrastructure.Landmarks;

/// <summary>
/// Imports OSM-sourced landmarks for a project via the Overpass API, maps curated
/// OSM tags to a <see cref="LandmarkCategory"/>, drops unnamed clutter, assigns a
/// deterministic relevance <c>Score</c>, and persists the survivors. Coordinate and
/// grid math live in the TS atlas-core engine; this service only stores PostGIS
/// <c>Point(4326)</c> geometry.
/// </summary>
public class LandmarkService(JourneyBookDbContext db, IOverpassClient overpass) : ILandmarkService
{
    public async Task<ImportLandmarksResponse?> ImportAsync(Guid projectId, ImportLandmarksRequest request, CancellationToken ct = default)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == projectId, ct))
        {
            return null;
        }

        var pois = await overpass.QueryLandmarksAsync(request.Bbox, ct);

        var created = new List<Landmark>();
        foreach (var poi in pois)
        {
            // Uncurated tags map to no category → drop (clutter).
            var category = MapCategory(poi.Tags);
            if (category is null) continue;

            var hasName = !string.IsNullOrWhiteSpace(poi.Name);

            // Drop rows with no name AND a low category value; prominent
            // categories (e.g. peaks) survive even unnamed.
            if (!hasName && !IsHighValue(category.Value)) continue;

            var landmark = new Landmark
            {
                ProjectId = projectId,
                Name = hasName ? poi.Name! : category.Value.ToString(),
                Location = ToPoint(poi.Lng, poi.Lat),
                Category = category.Value,
                Score = Score(category.Value, hasName),
                SourceTags = new Dictionary<string, string>(poi.Tags),
            };

            db.Landmarks.Add(landmark);
            created.Add(landmark);
        }

        await db.SaveChangesAsync(ct);

        var response = created
            .OrderByDescending(l => l.Score)
            .Select(ToResponse)
            .ToList();
        return new ImportLandmarksResponse(response.Count, response);
    }

    public async Task<IReadOnlyList<LandmarkResponse>?> ListAsync(Guid projectId, CancellationToken ct = default)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == projectId, ct))
        {
            return null;
        }

        var landmarks = await db.Landmarks
            .Where(l => l.ProjectId == projectId)
            .OrderByDescending(l => l.Score)
            .ToListAsync(ct);
        return landmarks.Select(ToResponse).ToList();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var landmark = await db.Landmarks.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (landmark is null) return false;
        db.Landmarks.Remove(landmark);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // --- mapping / scoring ------------------------------------------------

    /// <summary>
    /// Maps a curated OSM tag to a <see cref="LandmarkCategory"/>. Returns
    /// <c>null</c> when no curated tag matches (the row is uncurated clutter and
    /// should be dropped).
    /// </summary>
    private static LandmarkCategory? MapCategory(IReadOnlyDictionary<string, string> tags)
    {
        foreach (var (tag, category) in CuratedTags)
        {
            if (tags.TryGetValue(tag.Key, out var actual) &&
                string.Equals(actual, tag.Value, StringComparison.OrdinalIgnoreCase))
            {
                return category;
            }
        }
        return null;
    }

    /// <summary>
    /// Deterministic relevance score: category weight plus a fixed bonus for
    /// having a name. Higher = more prominent (used for density culling).
    /// </summary>
    private static double Score(LandmarkCategory category, bool hasName) =>
        Weight(category) + (hasName ? NameBonus : 0);

    private const double NameBonus = 5;

    private static double Weight(LandmarkCategory category) => category switch
    {
        LandmarkCategory.Peak => 10,
        LandmarkCategory.Tower => 8,
        LandmarkCategory.Viewpoint => 7,
        LandmarkCategory.Water => 6,
        LandmarkCategory.Worship => 5,
        LandmarkCategory.Civic => 5,
        LandmarkCategory.School => 4,
        LandmarkCategory.Station => 4,
        LandmarkCategory.Trailhead => 4,
        LandmarkCategory.Park => 3,
        _ => 1,
    };

    /// <summary>
    /// A prominent category survives even without a name; lesser categories are
    /// dropped when unnamed to cull clutter.
    /// </summary>
    private static bool IsHighValue(LandmarkCategory category) => Weight(category) >= 6;

    /// <summary>Curated OSM (key, value) → category map. Anything else is dropped.</summary>
    private static readonly Dictionary<(string Key, string Value), LandmarkCategory> CuratedTags = new()
    {
        [("natural", "peak")] = LandmarkCategory.Peak,
        [("natural", "water")] = LandmarkCategory.Water,
        [("natural", "spring")] = LandmarkCategory.Water,
        [("water", "lake")] = LandmarkCategory.Water,
        [("man_made", "tower")] = LandmarkCategory.Tower,
        [("man_made", "mast")] = LandmarkCategory.Tower,
        [("man_made", "water_tower")] = LandmarkCategory.Tower,
        [("amenity", "school")] = LandmarkCategory.School,
        [("amenity", "university")] = LandmarkCategory.School,
        [("amenity", "college")] = LandmarkCategory.School,
        [("amenity", "place_of_worship")] = LandmarkCategory.Worship,
        [("amenity", "townhall")] = LandmarkCategory.Civic,
        [("amenity", "courthouse")] = LandmarkCategory.Civic,
        [("amenity", "library")] = LandmarkCategory.Civic,
        [("amenity", "hospital")] = LandmarkCategory.Civic,
        [("amenity", "fire_station")] = LandmarkCategory.Civic,
        [("amenity", "police")] = LandmarkCategory.Civic,
        [("leisure", "park")] = LandmarkCategory.Park,
        [("leisure", "nature_reserve")] = LandmarkCategory.Park,
        [("boundary", "national_park")] = LandmarkCategory.Park,
        [("tourism", "viewpoint")] = LandmarkCategory.Viewpoint,
        [("highway", "trailhead")] = LandmarkCategory.Trailhead,
        [("information", "trailhead")] = LandmarkCategory.Trailhead,
        [("railway", "station")] = LandmarkCategory.Station,
        [("public_transport", "station")] = LandmarkCategory.Station,
    };

    // --- helpers ----------------------------------------------------------

    private static Point ToPoint(double lng, double lat) =>
        NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326)
            .CreatePoint(new Coordinate(lng, lat));

    private static LandmarkResponse ToResponse(Landmark l) =>
        new(
            l.Id,
            l.ProjectId,
            l.Name,
            l.Location.X,
            l.Location.Y,
            l.Category.ToString(),
            l.Score,
            l.SourceTags);
}

using JourneyBook.Application.Rendering;

namespace JourneyBook.Application.Landmarks;

/// <summary>
/// A raw point of interest returned by the Overpass API before category
/// mapping, culling, and scoring. <c>Tags</c> holds the raw OSM key/value
/// tags from which the landmark's <c>LandmarkCategory</c> is derived.
/// </summary>
public record OverpassPoi(
    double Lng,
    double Lat,
    string? Name,
    IReadOnlyDictionary<string, string> Tags);

/// <summary>
/// Import landmarks for a project from OSM via Overpass over the given
/// extent (WGS84 bounding box). Reuses <see cref="RenderBBoxDto"/> so the
/// extent contract matches the rendering pipeline.
/// </summary>
public record ImportLandmarksRequest(RenderBBoxDto Bbox);

/// <summary>Result of an Overpass import: the persisted landmarks and their count.</summary>
public record ImportLandmarksResponse(int Imported, IReadOnlyList<LandmarkResponse> Landmarks);

/// <summary>
/// A persisted, OSM-sourced landmark. <c>Category</c> is the string form of
/// the <c>LandmarkCategory</c> domain enum; <c>Score</c> is the deterministic
/// relevance score used for density culling (higher = more prominent).
/// </summary>
public record LandmarkResponse(
    Guid Id,
    Guid ProjectId,
    string Name,
    double Lng,
    double Lat,
    string Category,
    double Score,
    IReadOnlyDictionary<string, string> SourceTags);

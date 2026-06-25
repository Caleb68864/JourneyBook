namespace JourneyBook.Application.Landmarks;

/// <summary>
/// Use-cases for OSM-sourced landmarks within a project. Landmarks are imported
/// from OpenStreetMap via the Overpass API over a project extent, mapped from
/// curated OSM tags to a <c>LandmarkCategory</c>, culled of unnamed clutter, and
/// assigned a deterministic relevance <c>Score</c> for density culling. Point
/// geometry is persisted as PostGIS <c>Point(4326)</c>; coordinate/grid math
/// lives in the TS atlas-core engine, not here.
/// </summary>
public interface ILandmarkService
{
    /// <summary>
    /// Import landmarks for the given project from OSM/Overpass over the
    /// request extent. Maps curated tags to a <c>LandmarkCategory</c>, drops
    /// rows with no name and low category value, computes a deterministic
    /// <c>Score</c>, and persists the survivors. Returns <c>null</c> when the
    /// project does not exist (→ 404).
    /// </summary>
    Task<ImportLandmarksResponse?> ImportAsync(Guid projectId, ImportLandmarksRequest request, CancellationToken ct = default);

    /// <summary>
    /// List the landmarks for a project, ordered by descending <c>Score</c>.
    /// Returns <c>null</c> when the project does not exist (→ 404).
    /// </summary>
    Task<IReadOnlyList<LandmarkResponse>?> ListAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Delete a landmark by id. Returns <c>false</c> when it does not exist (→ 404).</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

namespace JourneyBook.Application.Locations;

/// <summary>
/// Thrown for invalid important-location input (e.g. an unknown
/// <c>Category</c> or <c>SourceConfidence</c> enum value).
/// </summary>
public class LocationValidationException(string message) : Exception(message);

/// <summary>
/// Use-cases for important locations within a project. Each location carries a
/// stable L-series label (<c>L{LocationNumber}</c>) that is assigned on create
/// and never renumbered on delete. Point geometry is persisted as PostGIS
/// <c>Point(4326)</c>; coordinate/grid math lives in the TS atlas-core engine,
/// not here.
/// </summary>
public interface ILocationService
{
    /// <summary>
    /// Create an important location within the given project. Returns
    /// <c>null</c> when the project does not exist (→ 404).
    /// </summary>
    Task<LocationResponse?> CreateAsync(Guid projectId, CreateLocationRequest request, CancellationToken ct = default);

    /// <summary>
    /// Bulk-create important locations from CSV text (continuing the L-series).
    /// Returns <c>null</c> when the project does not exist (→ 404); throws
    /// <see cref="LocationValidationException"/> with aggregated row errors (→ 400)
    /// when the CSV is malformed or any row is invalid (all-or-nothing).
    /// </summary>
    Task<ImportLocationsResponse?> ImportAsync(Guid projectId, ImportLocationsRequest request, CancellationToken ct = default);

    /// <summary>List the important locations for a project, ordered by L-series number.</summary>
    Task<IReadOnlyList<LocationResponse>?> ListAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Fetch a single important location by id.</summary>
    Task<LocationResponse?> GetAsync(Guid id, CancellationToken ct = default);

    /// <summary>Replace the mutable fields of an existing important location.</summary>
    Task<LocationResponse?> UpdateAsync(Guid id, UpdateLocationRequest request, CancellationToken ct = default);

    /// <summary>Delete an important location. L-series numbers are never reused or renumbered.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

namespace JourneyBook.Application.TileSources;

/// <summary>
/// Thrown when a tile source cannot be registered because its <c>Key</c>
/// already exists in the global registry (→ 409 Conflict at the endpoint).
/// </summary>
public class TileSourceValidationException(string message) : Exception(message);

/// <summary>
/// Use-cases for the global tile-source registry. Tile sources are not
/// project-scoped: each carries a unique <c>Key</c> used for by-key lookup.
/// The owned <see cref="TileCachePolicyDto"/> round-trips with each source.
/// </summary>
public interface ITileSourceService
{
    /// <summary>
    /// Register a new tile source. Throws <see cref="TileSourceValidationException"/>
    /// when a source with the same <c>Key</c> already exists.
    /// </summary>
    Task<TileSourceResponse> CreateAsync(CreateTileSourceRequest request, CancellationToken ct = default);

    /// <summary>List every tile source in the registry.</summary>
    Task<IReadOnlyList<TileSourceResponse>> ListAsync(CancellationToken ct = default);

    /// <summary>Fetch a single tile source by id. Returns <c>null</c> when not found.</summary>
    Task<TileSourceResponse?> GetAsync(Guid id, CancellationToken ct = default);

    /// <summary>Fetch a single tile source by its unique <c>Key</c>. Returns <c>null</c> when not found.</summary>
    Task<TileSourceResponse?> GetByKeyAsync(string key, CancellationToken ct = default);

    /// <summary>Replace the mutable fields of an existing tile source (the <c>Key</c> is immutable).</summary>
    Task<TileSourceResponse?> UpdateAsync(Guid id, UpdateTileSourceRequest request, CancellationToken ct = default);

    /// <summary>Delete a tile source. Returns <c>false</c> when no source with the id exists.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

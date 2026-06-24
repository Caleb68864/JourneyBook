namespace JourneyBook.Application.TileSources;

/// <summary>
/// Owned caching policy for a tile source: how long tiles may be reused and
/// whether they may be served while offline.
/// </summary>
public record TileCachePolicyDto(int MaxAgeSeconds, bool OfflineAllowed);

/// <summary>
/// Register a new tile source in the global registry. <c>Key</c> is unique
/// across the registry; attempting to reuse an existing key is a conflict.
/// </summary>
public record CreateTileSourceRequest(
    string Key,
    string Provider,
    string SourceUrl,
    string Attribution,
    int MaxZoom,
    TileCachePolicyDto Cache,
    string? Version = null,
    DateOnly? SourceDate = null,
    string Kind = "usgs-raster");

/// <summary>Replace the mutable fields of an existing tile source (the <c>Key</c> is immutable).</summary>
public record UpdateTileSourceRequest(
    string Provider,
    string SourceUrl,
    string Attribution,
    int MaxZoom,
    TileCachePolicyDto Cache,
    string? Version = null,
    DateOnly? SourceDate = null,
    string Kind = "usgs-raster");

/// <summary>A tile source as stored in the registry, including its owned cache policy.</summary>
public record TileSourceResponse(
    Guid Id,
    string Key,
    string Provider,
    string SourceUrl,
    string? Version,
    DateOnly? SourceDate,
    string Attribution,
    int MaxZoom,
    TileCachePolicyDto Cache,
    string Kind);

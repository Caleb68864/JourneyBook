using JourneyBook.Application.TileSources;
using Microsoft.Extensions.Configuration;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>One offline package on disk, as its own header describes it.</summary>
/// <param name="File">Path relative to <c>TileCache:PmTilesDir</c>, with forward slashes.</param>
/// <param name="SourceKeys">Keys of the <c>pmtiles</c> registry rows that serve this file (by <c>SourceUrl</c>).</param>
/// <param name="Error">Why the header could not be read; the other header fields are null then.</param>
public sealed record MapPackageEntry(
    string File,
    long Bytes,
    DateTimeOffset ModifiedAt,
    string? TileType,
    int? MinZoom,
    int? MaxZoom,
    double[]? Bbox,
    long? AddressedTiles,
    string[] SourceKeys,
    string? Error);

/// <summary>
/// Stage 7's cache manifest: every package archive under <c>TileCache:PmTilesDir</c>, read from
/// its own PMTiles header, with the registry rows that serve it.
/// </summary>
/// <remarks>
/// Decided by agent 2026-11-21 (owner may revisit): a manifest derived from the archives, not a
/// table. The header is the source of truth for what a package covers; a table copied from it
/// would need a writer (packages are made on the host by <c>journeybook package</c> and copied
/// in by hand) and could drift from the file. Nothing is migrated, so this is reversible; a
/// table can be added later and filled from exactly this listing.
/// </remarks>
public sealed class MapPackageManifest(IConfiguration config, ITileSourceService sources)
{
    private readonly string _root = Path.GetFullPath(
        config["TileCache:PmTilesDir"] is { Length: > 0 } d ? d : "data/map-packages");
    private readonly PmTilesReader _reader = new();

    public async Task<IReadOnlyList<MapPackageEntry>> ListAsync(CancellationToken ct = default)
    {
        var root = new DirectoryInfo(_root);
        if (!root.Exists) return [];

        var rows = (await sources.ListAsync(ct)).Where(s => s.Kind == "pmtiles").ToList();
        var entries = new List<MapPackageEntry>();
        foreach (var file in root.EnumerateFiles("*.pmtiles", SearchOption.AllDirectories).OrderBy(f => f.FullName, StringComparer.Ordinal))
        {
            var relative = Path.GetRelativePath(_root, file.FullName).Replace('\\', '/');
            var keys = rows
                .Where(r => Path.GetFullPath(Path.Combine(_root, LocalPathOf(r.SourceUrl))) == file.FullName)
                .Select(r => r.Key)
                .Order(StringComparer.Ordinal)
                .ToArray();
            try
            {
                await using var stream = file.OpenRead();
                var header = await _reader.ReadHeaderAsync(stream, ct);
                entries.Add(new MapPackageEntry(
                    relative, file.Length, file.LastWriteTimeUtc, TileTypeName(header.TileType),
                    header.MinZoom, header.MaxZoom, header.Bounds, header.AddressedTiles, keys, null));
            }
            catch (Exception ex) when (ex is InvalidDataException or IOException or UnauthorizedAccessException)
            {
                entries.Add(new MapPackageEntry(
                    relative, file.Length, file.LastWriteTimeUtc, null, null, null, null, null, keys, ex.Message));
            }
        }

        return entries;
    }

    /// <summary>
    /// Register a package as a <c>pmtiles</c> tile source, from the archive itself: max zoom from its
    /// header; the source it was made from and its credit from the metadata <c>journeybook package</c>
    /// writes (<c>source</c>, <c>attribution</c>). Refused unless that source is in the registry and
    /// allows offline use (owner decision 2026-11-16), since the new row inherits those terms.
    /// </summary>
    /// <exception cref="MapPackageRegistrationException">Why it cannot be registered (the caller answers 400/404/409).</exception>
    public async Task<TileSourceResponse> RegisterAsync(string file, string? key, CancellationToken ct = default)
    {
        var resolved = Path.GetFullPath(Path.Combine(_root, file));
        var rootSep = _root.EndsWith(Path.DirectorySeparatorChar) ? _root : _root + Path.DirectorySeparatorChar;
        if (!resolved.StartsWith(rootSep, StringComparison.Ordinal) || !resolved.EndsWith(".pmtiles", StringComparison.Ordinal))
        {
            throw new MapPackageRegistrationException(400, $"'{file}' is not a .pmtiles file inside the packages folder.");
        }
        if (!File.Exists(resolved))
        {
            throw new MapPackageRegistrationException(404, $"No package '{file}' in the packages folder.");
        }

        PmTilesHeader header;
        string? sourceKey;
        string? attribution;
        try
        {
            await using var stream = File.OpenRead(resolved);
            header = await _reader.ReadHeaderAsync(stream, ct);
            using var metadata = await _reader.ReadMetadataAsync(stream, ct);
            sourceKey = StringOf(metadata, "source");
            attribution = StringOf(metadata, "attribution");
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or System.Text.Json.JsonException)
        {
            throw new MapPackageRegistrationException(400, $"'{file}' is not a readable PMTiles package: {ex.Message}");
        }

        if (sourceKey is null)
        {
            throw new MapPackageRegistrationException(400,
                $"'{file}' does not say which tile source it was made from (no 'source' in its metadata), so its terms are unknown.");
        }
        var origin = await sources.GetByKeyAsync(sourceKey, ct);
        if (origin is null)
        {
            throw new MapPackageRegistrationException(400,
                $"'{file}' was made from tile source '{sourceKey}', which is not in the registry, so its terms are unknown.");
        }
        if (!origin.Cache.OfflineAllowed)
        {
            throw new MapPackageRegistrationException(400,
                $"'{file}' was made from tile source '{sourceKey}', whose terms do not allow offline use.");
        }

        var relative = Path.GetRelativePath(_root, resolved).Replace('\\', '/');
        var newKey = string.IsNullOrWhiteSpace(key) ? KeyFor(relative) : key.Trim();
        try
        {
            return await sources.CreateAsync(new CreateTileSourceRequest(
                Key: newKey,
                Provider: origin.Provider,
                SourceUrl: relative,
                Attribution: string.IsNullOrWhiteSpace(attribution) ? origin.Attribution : attribution,
                MaxZoom: header.MaxZoom,
                Cache: new TileCachePolicyDto(origin.Cache.MaxAgeSeconds, OfflineAllowed: true),
                Version: origin.Version,
                SourceDate: origin.SourceDate,
                Kind: "pmtiles"), ct);
        }
        catch (TileSourceValidationException ex)
        {
            throw new MapPackageRegistrationException(409, ex.Message);
        }
    }

    /// <summary><c>ne/lincoln.pmtiles</c> → <c>package-ne-lincoln</c>.</summary>
    private static string KeyFor(string relative)
    {
        var stem = relative[..^".pmtiles".Length].ToLowerInvariant();
        var cleaned = new string(stem.Select(c => char.IsAsciiLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
        return "package-" + cleaned;
    }

    private static string? StringOf(System.Text.Json.JsonDocument? doc, string name) =>
        doc is not null && doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object
        && doc.RootElement.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String
            ? v.GetString()
            : null;

    private static string LocalPathOf(string sourceUrl) =>
        sourceUrl.StartsWith("file://", StringComparison.OrdinalIgnoreCase) ? new Uri(sourceUrl).LocalPath : sourceUrl;

    private static string TileTypeName(byte t) => t switch
    {
        1 => "mvt",
        2 => "png",
        3 => "jpeg",
        4 => "webp",
        5 => "avif",
        _ => "unknown",
    };
}

/// <summary>Why a package could not be registered, with the HTTP status that says so.</summary>
public sealed class MapPackageRegistrationException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

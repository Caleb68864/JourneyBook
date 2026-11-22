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

using JourneyBook.Application.TileSources;
using Microsoft.Extensions.Configuration;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Serves tiles from a PMTiles archive referenced by a registry row's <c>SourceUrl</c>. A local
/// path is resolved <b>inside</b> the configured <c>TileCache:PmTilesDir</c> root (default
/// <c>data/map-packages</c>) using the same path-confinement guard as the cache — a path escaping
/// the root is refused (returns <c>null</c> → 502), so a malicious <c>file:///etc/passwd</c> row
/// can never read arbitrary files. An <c>http(s)</c> URL is read via HTTP range requests.
/// A tile absent from the archive yields <see cref="FetchedTile.Empty"/> (→ 204).
/// </summary>
public sealed class PmTilesFetcher(HttpClient http, IConfiguration config) : ITileFetcher
{
    private readonly string _root = Path.GetFullPath(
        config["TileCache:PmTilesDir"] is { Length: > 0 } d ? d : "data/map-packages");
    private readonly PmTilesReader _reader = new();

    public bool CanHandle(string kind) => kind == "pmtiles";

    public async Task<FetchedTile?> FetchAsync(TileSourceResponse source, int z, int x, int y, CancellationToken ct)
    {
        try
        {
            var url = source.SourceUrl;
            var isRemote = url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                        || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

            Stream archive;
            if (isRemote)
            {
                archive = new HttpRangeStream(http, url);
            }
            else
            {
                var local = url.StartsWith("file://", StringComparison.OrdinalIgnoreCase) ? new Uri(url).LocalPath : url;
                var resolved = Path.GetFullPath(Path.Combine(_root, local));
                var rootSep = _root.EndsWith(Path.DirectorySeparatorChar) ? _root : _root + Path.DirectorySeparatorChar;
                if (!resolved.StartsWith(rootSep, StringComparison.Ordinal))
                {
                    return null; // path escapes the archives root → refuse (502)
                }
                if (!File.Exists(resolved))
                {
                    return null; // missing archive → 502
                }
                archive = File.OpenRead(resolved);
            }

            await using (archive)
            {
                var tileType = await _reader.ReadTileTypeAsync(archive, ct);
                var bytes = await _reader.ReadTileAsync(archive, z, x, y, ct);
                if (bytes is null)
                {
                    return new FetchedTile([], ContentTypeFor(tileType), Empty: true);
                }
                return new FetchedTile(bytes, ContentTypeFor(tileType), Empty: false);
            }
        }
        catch
        {
            return null; // corrupt/unreadable archive → 502
        }
    }

    private static string ContentTypeFor(byte tileType) => tileType switch
    {
        1 => "application/x-protobuf",
        2 => "image/png",
        3 => "image/jpeg",
        4 => "image/webp",
        _ => "application/octet-stream",
    };
}

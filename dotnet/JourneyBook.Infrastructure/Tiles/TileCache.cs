namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// Disk-backed tile cache under a single root (default <c>data/cache</c>), keyed
/// <c>{source}/{z}/{x}/{y}.{ext}</c>. The store records the real extension (png/pbf/…); the
/// lookup discovers whichever <c>{y}.*</c> exists, so a tile cached as <c>pbf</c> is found on the
/// next request without the caller having to know the type up front. Every path is confined to
/// the root using the same resolved-path <c>StartsWith</c> idiom as
/// <c>GeneratedPdfService.TryDeleteArtifact</c>: a key that escapes the root (e.g. <c>../</c>) is
/// treated as a miss / skipped store, never written. Stores are atomic (temp file + rename) so a
/// concurrent reader never sees a torn tile.
/// </summary>
public sealed class TileCache
{
    private readonly string _root;

    public TileCache(string cacheRoot)
    {
        _root = Path.GetFullPath(string.IsNullOrWhiteSpace(cacheRoot) ? "data/cache" : cacheRoot);
    }

    /// <summary>True on a hit; <paramref name="ext"/> is the discovered file extension (no dot).</summary>
    public bool TryGet(string sourceKey, int z, int x, int y, out byte[] bytes, out string ext)
    {
        bytes = [];
        ext = string.Empty;

        if (!TryResolveDir(sourceKey, z, x, out var dir) || !Directory.Exists(dir))
        {
            return false;
        }

        try
        {
            var match = Directory.EnumerateFiles(dir, $"{y}.*").FirstOrDefault();
            if (match is null)
            {
                return false;
            }

            bytes = File.ReadAllBytes(match);
            ext = Path.GetExtension(match).TrimStart('.');
            return true;
        }
        catch
        {
            bytes = [];
            ext = string.Empty;
            return false;
        }
    }

    public void Store(string sourceKey, int z, int x, int y, string ext, byte[] bytes)
    {
        if (!TryResolveDir(sourceKey, z, x, out var dir))
        {
            // Escaping key: skip rather than write outside the cache root.
            return;
        }

        try
        {
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, $"{y}.{ext}");
            var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllBytes(temp, bytes);
            File.Move(temp, path, overwrite: true);
        }
        catch
        {
            // Best-effort: a cache write failure must not break tile serving.
        }
    }

    /// <summary>
    /// Builds the <c>{root}/{source}/{z}/{x}</c> directory and confirms it resolves within the
    /// cache root. Returns false (and an empty path) when the composed path would escape the root.
    /// </summary>
    private bool TryResolveDir(string sourceKey, int z, int x, out string dir)
    {
        dir = string.Empty;
        var candidate = Path.GetFullPath(Path.Combine(_root, sourceKey, z.ToString(), x.ToString()));
        var rootWithSep = _root.EndsWith(Path.DirectorySeparatorChar) ? _root : _root + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(rootWithSep, StringComparison.Ordinal))
        {
            return false;
        }

        dir = candidate;
        return true;
    }
}

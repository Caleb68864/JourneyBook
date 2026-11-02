using System.Text.RegularExpressions;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>What one <see cref="TileCache.Prune"/> did.</summary>
public sealed record TileCachePruneResult(int RemovedTiles, int RemovedTempFiles, long BytesRemaining);

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
    /// <summary>A temp file this old was abandoned by a crash; a newer one may be a write in progress.</summary>
    private static readonly TimeSpan StaleTempFileAge = TimeSpan.FromHours(1);

    private static readonly Regex TileFileName = new(@"^\d+(\.[A-Za-z0-9]+)?$", RegexOptions.CultureInvariant);
    private static readonly Regex TempFileName = new(@"^\d+(\.[A-Za-z0-9]+)?\.tmp-", RegexOptions.CultureInvariant);

    private readonly string _root;

    public TileCache(string cacheRoot)
    {
        _root = Path.GetFullPath(string.IsNullOrWhiteSpace(cacheRoot) ? "data/cache" : cacheRoot);
    }

    /// <summary>
    /// True for a finished cache entry: <c>{y}</c>, or <c>{y}.{ext}</c> with a single
    /// alphanumeric extension segment. Anything else — notably the <c>.tmp-{guid}</c>
    /// file <see cref="Store"/> writes before renaming — is not a hit.
    /// </summary>
    private static bool IsTileName(string name, int y)
    {
        var stem = y.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (name == stem)
        {
            return true;
        }

        if (!name.StartsWith(stem + ".", StringComparison.Ordinal))
        {
            return false;
        }

        var ext = name[(stem.Length + 1)..];
        return ext.Length > 0 && ext.All(char.IsLetterOrDigit);
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
            // `{y}` or `{y}.{ext}` and nothing else. The `{y}.*` glob also matches
            // the `{y}.{ext}.tmp-{guid}` file Store writes before its rename, so a
            // concurrent reader would be handed a half-written tile as a hit —
            // defeating the atomicity the temp-file dance exists for.
            var match = Directory
                .EnumerateFiles(dir, $"{y}.*")
                .Concat(Directory.EnumerateFiles(dir, $"{y}"))
                .FirstOrDefault(path => IsTileName(Path.GetFileName(path), y));
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
    /// Bring the cache down to <paramref name="maxBytes"/>, deleting the oldest-written tiles
    /// first, plus any abandoned temp file. Touches only files in the
    /// <c>{source}/{z}/{x}/{y}[.{ext}]</c> layout, so a root pointed at the wrong directory
    /// deletes nothing else. Mirrors <c>pruneTileCache</c> in TypeScript, since both can own one
    /// directory; <c>data/fixtures/tile-cache-prune.json</c> holds them together. A tile deleted
    /// under a concurrent reader is a miss, and is fetched again.
    /// </summary>
    public TileCachePruneResult Prune(long maxBytes, DateTime? utcNow = null)
    {
        var now = utcNow ?? DateTime.UtcNow;
        var tiles = new List<(FileInfo File, string Relative)>();
        var removedTempFiles = 0;

        foreach (var file in LayoutFiles())
        {
            if (TileFileName.IsMatch(file.Name))
            {
                tiles.Add((file, Path.GetRelativePath(_root, file.FullName).Replace('\\', '/')));
            }
            else if (TempFileName.IsMatch(file.Name)
                     && now - file.LastWriteTimeUtc >= StaleTempFileAge
                     && TryDelete(file))
            {
                removedTempFiles++;
            }
        }

        var oldestFirst = tiles
            .OrderBy(t => t.File.LastWriteTimeUtc)
            .ThenBy(t => t.Relative, StringComparer.Ordinal);
        var bytesRemaining = tiles.Sum(t => t.File.Length);
        var removedTiles = 0;
        var touched = new HashSet<string>();

        foreach (var (file, _) in oldestFirst)
        {
            if (bytesRemaining <= maxBytes)
            {
                break;
            }

            var length = file.Length;
            var directory = file.DirectoryName!;
            if (TryDelete(file))
            {
                bytesRemaining -= length;
                removedTiles++;
                touched.Add(directory);
            }
        }

        foreach (var directory in touched)
        {
            TryDeleteEmptyDirectoryAndParent(directory);
        }

        return new TileCachePruneResult(removedTiles, removedTempFiles, bytesRemaining);
    }

    /// <summary>Every file at <c>{source}/{z}/{x}/</c> with numeric <c>z</c> and <c>x</c>.</summary>
    private IEnumerable<FileInfo> LayoutFiles()
    {
        var root = new DirectoryInfo(_root);
        if (!root.Exists)
        {
            return [];
        }

        return root.EnumerateDirectories()
            .SelectMany(source => source.EnumerateDirectories().Where(d => IsNumber(d.Name)))
            .SelectMany(z => z.EnumerateDirectories().Where(d => IsNumber(d.Name)))
            .SelectMany(x => x.EnumerateFiles())
            .ToList();
    }

    private static bool IsNumber(string name) => name.Length > 0 && name.All(char.IsAsciiDigit);

    private static bool TryDelete(FileInfo file)
    {
        try
        {
            file.Delete();
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Still on disk, so still counted; the next prune retries it.
            return false;
        }
    }

    private static void TryDeleteEmptyDirectoryAndParent(string directory)
    {
        try
        {
            // Non-recursive: refusing a directory that is not empty is the check.
            Directory.Delete(directory);
            Directory.Delete(Path.GetDirectoryName(directory)!);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Not empty, or a concurrent store just used it. Either is fine.
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

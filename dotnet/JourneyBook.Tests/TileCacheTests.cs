using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests;

public class TileCacheTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "jb-tilecache-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public void TryGet_returns_false_on_miss()
    {
        var cache = new TileCache(_root);
        Assert.False(cache.TryGet("usgs-topo", 2, 1, 1, out var bytes, out _));
        Assert.Empty(bytes);
    }

    [Fact]
    public void Store_then_TryGet_round_trips_bytes_and_ext()
    {
        var cache = new TileCache(_root);
        var payload = new byte[] { 1, 2, 3, 4 };
        cache.Store("usgs-topo", 5, 9, 9, "png", payload);

        Assert.True(cache.TryGet("usgs-topo", 5, 9, 9, out var bytes, out var ext));
        Assert.Equal(payload, bytes);
        Assert.Equal("png", ext);
    }

    [Fact]
    public void TryGet_discovers_stored_ext_for_pbf()
    {
        var cache = new TileCache(_root);
        cache.Store("vector-src", 3, 2, 1, "pbf", new byte[] { 7 });

        Assert.True(cache.TryGet("vector-src", 3, 2, 1, out _, out var ext));
        Assert.Equal("pbf", ext);
    }

    [Fact]
    public void Store_with_traversal_key_writes_nothing_outside_root()
    {
        var cache = new TileCache(_root);
        var probe = Path.GetFullPath(Path.Combine(_root, "..", "jb-escape-probe.png"));
        if (File.Exists(probe)) File.Delete(probe);

        // A source key that tries to climb out of the cache root.
        cache.Store("../jb-escape-probe-dir", 0, 0, 0, "png", new byte[] { 9 });

        Assert.False(File.Exists(probe));
        // And the escaping write is a no-op: a subsequent read is a miss.
        Assert.False(cache.TryGet("../jb-escape-probe-dir", 0, 0, 0, out _, out _));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}

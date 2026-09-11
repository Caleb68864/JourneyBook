using System.Text;
using System.Text.Json;
using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests;

/// <summary>
/// The C# half of the shared tile-cache contract.
/// <c>packages/map-sources/src/tilecache-layout.test.ts</c> is the TypeScript half,
/// and both read <c>data/fixtures/tile-cache-layout.json</c>.
/// </summary>
/// <remarks>
/// <para>
/// The cache is implemented twice, in two languages, deliberately: the headless CLI
/// and the API proxy share one cache directory and neither language can call the
/// other. That is a load-bearing copy, not a mistake — but it is only correct while
/// the two agree, and until now nothing compared them on the parts that decide
/// whether a tile written by one side is ever FOUND by the other.
/// </para>
/// <para>
/// <c>tile-content-types.json</c> already pins the extension mapping, and it exists
/// because those two copies HAD diverged (the TS store site filed every tile as
/// <c>.png</c>). The layout and the hit rule were the remaining pair, each held in a
/// comment on its own side.
/// </para>
/// </remarks>
public class TileCacheLayoutParityTests : IDisposable
{
    private sealed record LayoutCase(string Source, int Z, int X, int Y, string Ext, string RelativePath);
    private sealed record HitCase(int Y, string Name, bool IsHit, string Why);
    private sealed record Fixture(
        LayoutCase[] Layout,
        HitCase[] HitNames,
        string[] EscapingKeys);

    private static readonly JsonSerializerOptions s_json = new() { PropertyNameCaseInsensitive = true };

    private readonly string _root = Path.Combine(
        Path.GetTempPath(), "jb-cache-parity-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true); }
        catch { /* best effort */ }
        GC.SuppressFinalize(this);
    }

    private static string RepoFile(string relative)
    {
        var suffix = relative.Replace('/', Path.DirectorySeparatorChar);
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, suffix);
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new FileNotFoundException(
            $"Could not find {relative} walking up from {AppContext.BaseDirectory}.");
    }

    private static Fixture Load()
    {
        var path = RepoFile("data/fixtures/tile-cache-layout.json");
        var fixture = JsonSerializer.Deserialize<Fixture>(File.ReadAllText(path), s_json)
            ?? throw new InvalidOperationException($"{path} did not parse.");

        // Refuse rather than degrade. A fixture that parsed to empty arrays would let
        // every loop below iterate zero times and report success on nothing.
        if (fixture.Layout.Length < 2 || fixture.HitNames.Length < 5 || fixture.EscapingKeys.Length < 2)
        {
            throw new InvalidOperationException(
                $"{path} parsed but is too small to be the table this test exists to compare against: " +
                $"{fixture.Layout.Length} layout, {fixture.HitNames.Length} hit-name, " +
                $"{fixture.EscapingKeys.Length} escaping-key cases.");
        }
        return fixture;
    }

    [Fact]
    public void The_fixture_was_actually_read_and_says_both_yes_and_no()
    {
        var fixture = Load();
        Assert.Contains(fixture.HitNames, h => h.IsHit);
        // Without a negative case the hit rule is satisfied by a cache that calls
        // every file a hit — including the half-written temp file.
        Assert.Contains(fixture.HitNames, h => !h.IsHit);
    }

    [Fact]
    public void Writes_each_tile_exactly_where_the_shared_layout_says()
    {
        var fixture = Load();
        var cache = new TileCache(_root);

        foreach (var c in fixture.Layout)
        {
            cache.Store(c.Source, c.Z, c.X, c.Y, c.Ext, Encoding.UTF8.GetBytes(c.RelativePath));
            var expected = Path.Combine(_root, c.RelativePath.Replace('/', Path.DirectorySeparatorChar));
            Assert.True(
                File.Exists(expected),
                $"stored {c.Source}/{c.Z}/{c.X}/{c.Y}.{c.Ext} somewhere other than {c.RelativePath}");
        }
    }

    [Fact]
    public void Reads_back_a_tile_the_other_implementation_could_have_written()
    {
        var fixture = Load();
        var cache = new TileCache(_root);

        foreach (var c in fixture.Layout)
        {
            // Written by path rather than through Store: this is the half that
            // matters across the language boundary — bytes the headless CLI put there.
            var dir = Path.Combine(_root, c.Source, c.Z.ToString(), c.X.ToString());
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, $"{c.Y}.{c.Ext}"), "tile"u8.ToArray());

            Assert.True(
                cache.TryGet(c.Source, c.Z, c.X, c.Y, out _, out var ext),
                $"missed {c.RelativePath}, which the TypeScript side would have written");
            Assert.Equal(c.Ext, ext);
        }
    }

    [Fact]
    public void Agrees_on_which_filenames_are_a_finished_tile()
    {
        var fixture = Load();
        var cache = new TileCache(_root);

        foreach (var c in fixture.HitNames)
        {
            // One directory per case, keyed on the name's length so cases cannot
            // pollute each other.
            var dir = Path.Combine(_root, "hitrule", c.Name.Length.ToString(), "0");
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, c.Name), "bytes"u8.ToArray());

            var hit = cache.TryGet("hitrule", c.Name.Length, 0, c.Y, out _, out _);
            Assert.True(hit == c.IsHit, $"{c.Name} for y={c.Y}: {c.Why}");
        }
    }

    [Fact]
    public void Treats_an_escaping_source_key_as_a_miss_and_writes_nothing()
    {
        var fixture = Load();
        var cache = new TileCache(_root);

        foreach (var key in fixture.EscapingKeys)
        {
            cache.Store(key, 1, 2, 3, "png", "escaped"u8.ToArray());
            Assert.False(cache.TryGet(key, 1, 2, 3, out _, out _), $"escaping key `{key}` was honoured");
        }

        // The control for the loop above: a NORMAL key must still store and read
        // back, or "wrote nothing" is satisfied by a cache that never writes at all.
        cache.Store("control-source", 1, 2, 3, "png", "kept"u8.ToArray());
        Assert.True(cache.TryGet("control-source", 1, 2, 3, out _, out _));
    }
}

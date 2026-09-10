using System.Text.Json;
using JourneyBook.Infrastructure.Tiles;

namespace JourneyBook.Tests;

/// <summary>
/// The tile disk cache is implemented twice — <c>TileService</c>/<c>TileCache</c>
/// here and <c>packages/map-sources/src/tilecache.ts</c> in the engine — writing
/// into ONE directory layout, <c>{source}/{z}/{x}/{y}.{ext}</c>, on purpose: the
/// CLI and the API are meant to share a cache. That makes the Content-Type ->
/// extension table a contract between the two, and it had already broken: the TS
/// store site passed a literal <c>"png"</c> for every tile it fetched, so a JPEG
/// cached by the headless CLI was filed as <c>.png</c> and this proxy then served
/// it as <c>image/png</c>.
///
/// Both sides are now tested against ONE file, <c>data/fixtures/tile-content-types.json</c>,
/// rather than each against a copy of itself. A test that asserted this switch
/// against a C# literal would prove only that the switch is the switch.
/// </summary>
public class TileMediaTypeParityTests
{
    private sealed record Fixture(
        Dictionary<string, string> ExtensionForContentType,
        Dictionary<string, string> ContentTypeForExtension);

    /// <summary>
    /// Walk up from the test binary to the repository root and read the shared
    /// fixture. Throws rather than returning empty: a parity test that cannot
    /// find the thing it compares against must fail loudly, not pass vacuously
    /// by iterating an empty dictionary.
    /// </summary>
    private static Fixture LoadFixture()
    {
        const string relative = "data/fixtures/tile-content-types.json";
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, relative.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(candidate))
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var fixture = JsonSerializer.Deserialize<Fixture>(File.ReadAllText(candidate), options)
                    ?? throw new InvalidOperationException($"{candidate} did not deserialize.");
                if (fixture.ExtensionForContentType.Count == 0 || fixture.ContentTypeForExtension.Count == 0)
                {
                    throw new InvalidOperationException($"{candidate} has an empty mapping table.");
                }
                return fixture;
            }
            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            $"Could not find {relative} walking up from {AppContext.BaseDirectory}. " +
            "This test compares the C# tile media-type table against the TypeScript one; " +
            "without the fixture it has no opinion and must not report success.");
    }

    [Fact]
    public void Fixture_is_found_and_populated()
    {
        // The control for every loop below. Both of those are satisfied by an
        // empty table, which is precisely how a cross-language parity test comes
        // to assert nothing at all.
        var fixture = LoadFixture();
        Assert.True(fixture.ExtensionForContentType.Count >= 5);
        Assert.True(fixture.ContentTypeForExtension.Count >= 5);
    }

    [Fact]
    public void ExtFor_matches_the_shared_fixture()
    {
        var fixture = LoadFixture();
        foreach (var (contentType, expected) in fixture.ExtensionForContentType)
        {
            Assert.Equal(expected, TileService.ExtFor(contentType));
        }
    }

    [Fact]
    public void ContentTypeFor_matches_the_shared_fixture()
    {
        var fixture = LoadFixture();
        foreach (var (ext, expected) in fixture.ContentTypeForExtension)
        {
            Assert.Equal(expected, TileService.ContentTypeFor(ext));
        }
    }

    [Fact]
    public void Every_extension_the_table_produces_round_trips_to_a_real_content_type()
    {
        // The property that actually matters at runtime: whatever extension a
        // fetch's Content-Type is filed under, a later cache HIT must be served
        // with a Content-Type that means the same thing. `image/png` for a `.jpg`
        // file is the bug this whole pair exists to prevent.
        var fixture = LoadFixture();
        foreach (var (contentType, ext) in fixture.ExtensionForContentType)
        {
            var served = TileService.ContentTypeFor(ext);
            if (string.IsNullOrEmpty(contentType) || !fixture.ContentTypeForExtension.ContainsKey(ext))
            {
                continue; // unknown input: the png fallback is the documented answer
            }
            Assert.Equal(fixture.ContentTypeForExtension[ext], served);
        }
    }
}

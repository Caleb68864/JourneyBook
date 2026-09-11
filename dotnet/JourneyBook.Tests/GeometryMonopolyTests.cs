using System.Text.RegularExpressions;

namespace JourneyBook.Tests;

/// <summary>
/// ADR 0004 — "TS <c>atlas-core</c> is the one source of truth for geometry; never
/// reimplement projection/grid/scale math in C#" — enforced by something other than
/// reviewer memory.
/// </summary>
/// <remarks>
/// <para>
/// This is the single most important invariant in the project. It is cited as
/// binding in eight places (<c>CLAUDE.md</c>, <c>panel.ts</c>,
/// <c>GeneratedPdfService.cs</c>, <c>render-fidelity-check.mjs</c>, the staged-build
/// roadmap, two audit files), its text does not exist because <c>docs/*</c> was
/// gitignored when it was written, and <c>docs/decisions/README.md</c> says of it
/// in as many words: <b>"Nothing enforces it mechanically."</b>
/// </para>
/// <para>
/// What stood in for enforcement was a dated manual search — "Verified still held
/// as of 2026-09-09: an exhaustive search for trigonometry, earth radii and
/// degree/radian conversion across <c>dotnet/</c> and <c>apps/api/</c> found none".
/// A correct value written down on a date is the repair that regresses fastest:
/// it is true until the next commit and nothing says when it stops being true. And
/// the previous search's own conclusion was WRONG in one direction it did not look
/// — it searched C# for projection math and reported the monopoly intact, while a
/// second projection implementation sat in <c>map-sources/src/tilemath.ts</c>,
/// outside <c>atlas-core</c>, in the other language. A guard's scope is a claim.
/// </para>
/// <para>
/// So: what this guard catches, and — more usefully — what it does not.
/// </para>
/// <para>
/// <b>It catches</b> the vocabulary geometry cannot be written without: trigonometry,
/// <c>Math.PI</c>, the log/exp pair a Web-Mercator latitude needs, the earth's radius
/// and the Mercator extent as literals, degree/radian conversion in either
/// direction, the two ways to say "tiles per axis at zoom z" — and, since
/// 2026-09-11, the dull vocabulary: metres per degree of latitude, the inch/metre
/// conversion, and <c>Math.Sqrt</c>.
/// </para>
/// <para>
/// <b>Why that last group was added, because it is the more useful half of the
/// lesson.</b> Every pattern in the first group was chosen by someone thinking about
/// how you would VIOLATE this rule, and those are the exotic ways — spherical
/// trigonometry, an earth radius, a radian conversion. The idiomatic way does not
/// feel like geometry while you are writing the list. Measured: a metres-per-degree
/// bbox padder built on <c>111320.0</c> and a planar-distance helper using
/// <c>Math.Sqrt</c> were both added to a governed root and <b>all 216 .NET tests
/// passed</b>. A guard covers the ways its author thought of; test one with the most
/// boring violation you can construct, not the cleverest.
/// </para>
/// <para>
/// <b>It does not catch</b>, and these are not oversights but the honest edge of a
/// text scan:
/// </para>
/// <list type="bullet">
/// <item>Geometry written with no named constant, no trig and no square root — a
/// linear interpolation in degrees, a page count as a division.
/// <c>LandmarkService</c>'s scoring is arithmetic over a category table and is
/// invisible here, correctly, because it is not geometry; a page-count formula
/// would be equally invisible and would not be.</item>
/// <item>Geometry delegated to NetTopologySuite — <c>Buffer</c>, <c>Distance</c>,
/// <c>Centroid</c>. Storage use of NTS is sanctioned (SRID 4326 points and rings),
/// and this scan cannot tell a ring from a distance calculation.</item>
/// <item>Geometry in a language this scan does not read. The rule's whole subject
/// is "not in C#", so TypeScript that reimplements <c>atlas-core</c> outside it —
/// which has happened — is out of scope by construction.</item>
/// <item><c>PmTilesReader.ZxyToTileId</c>, the Hilbert curve the PMTiles archive
/// format requires. It is bit arithmetic, matches none of these patterns, and was
/// examined and cleared by an earlier audit as an archive-format detail rather
/// than map projection. Recorded here so the next reader does not re-derive it.</item>
/// </list>
/// </remarks>
public class GeometryMonopolyTests
{
    /// <summary>Directories that ADR 0004 governs, relative to the repo root.</summary>
    private static readonly string[] GovernedRoots =
    [
        "dotnet/JourneyBook.Domain",
        "dotnet/JourneyBook.Application",
        "dotnet/JourneyBook.Infrastructure",
        "apps/api",
    ];

    /// <summary>
    /// Generated EF migrations are excluded: they are output, not authored code, and
    /// a seeded coordinate in one is data.
    /// </summary>
    private static readonly string[] SkipDirs = ["bin", "obj", "Migrations", ".git"];

    /// <summary>The vocabulary, with the name each hit is reported under.</summary>
    private static readonly (string Name, Regex Pattern)[] Vocabulary =
    [
        ("trigonometry", new Regex(@"Math\.(Sin|Cos|Tan|Asin|Acos|Atan|Atan2|Sinh|Cosh|Tanh)\b")),
        ("pi", new Regex(@"Math\.PI\b")),
        ("log/exp (a Web-Mercator latitude needs both)", new Regex(@"Math\.(Log|Exp)\b")),
        ("earth radius / mercator extent literal",
            new Regex(@"\b(6378137|6371000|20037508|40075016|40075017)\b")),
        ("degree<->radian conversion",
            new Regex(@"(180\s*/\s*Math\.PI|Math\.PI\s*/\s*180|ToRadians|ToDegrees|DegreesTo|RadiansTo)")),
        ("tiles per axis at zoom", new Regex(@"1\s*u?\s*<<\s*\w*[zZ]")),
        ("2^zoom", new Regex(@"Math\.Pow\s*\(\s*2\s*,")),

        // ── The dull ones ────────────────────────────────────────────────────
        //
        // Everything above was written by someone thinking about how you would
        // VIOLATE this rule, and those are the exotic ways: spherical trigonometry,
        // an earth radius, a radian conversion. The everyday way does not feel like
        // geometry while you are writing the list, and it was measured: a
        // `PadExtentMetres` built on `const double MetresPerDegreeLat = 111320.0`
        // and a `PlanarMetres` using `Math.Sqrt`, both added to a governed root,
        // and ALL 216 .NET TESTS PASSED. `111320`, `Math.Sqrt` and `0.0254` were
        // in no pattern above.
        //
        // A guard covers the ways its author thought of. Test one with the most
        // boring violation you can construct, not the cleverest — the clever one is
        // probably already covered.
        ("metres per degree literal",
            new Regex(@"\b111(320|319|325|111|194)(\.\d+)?\b|\b110(540|574|574\.3)(\.\d+)?\b")),
        ("inch<->metre conversion literal",
            new Regex(@"(?<![\d.])(0\.0254|25\.4|39\.3700?\d*)(?![\d])")),
        ("square root / hypotenuse (how a planar distance is spelled)",
            new Regex(@"Math\.(Sqrt|Hypot|Cbrt)\b")),
    ];

    /// <summary>
    /// Geometry-shaped C# that is allowed to exist, and why.
    /// </summary>
    /// <remarks>
    /// One entry. It is a CLAIM, checked below like any other: an exemption naming a
    /// file that no longer trips the scan is a reason for something that is not
    /// happening, and it fails rather than lingering. An allowlist nobody re-derives
    /// is how this repo's last two false exemptions survived.
    /// </remarks>
    private static readonly IReadOnlyDictionary<string, string> Exempt =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["apps/api/Endpoints/TileEndpoints.cs"] =
                "`var perAxis = 1 << z` bounds an x/y tile index against the zoom the caller " +
                "asked for, before the proxy fetches anything. It is a RANGE GUARD on an " +
                "untrusted integer, not a projection: nothing is placed on a map with it and " +
                "no coordinate is derived from it. The alternative — asking the engine over " +
                "HTTP how many tiles a zoom has, per tile request — would put a network call " +
                "in front of a bounds check. `map-sources/src/tilemath.ts` states the same " +
                "quantity, and `TileCacheLayoutParityTests` pins the cache layout the two share.",
        };

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "JourneyBook.slnx"))) return dir.FullName;
            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException(
            $"Could not find the repo root (JourneyBook.slnx) walking up from {AppContext.BaseDirectory}. " +
            "Fix this walk — do not let the geometry guard quietly pass on no files.");
    }

    private static IReadOnlyList<string> GovernedFiles()
    {
        var root = RepoRoot();
        var files = new List<string>();
        foreach (var governed in GovernedRoots)
        {
            var dir = Path.Combine(root, governed.Replace('/', Path.DirectorySeparatorChar));
            if (!Directory.Exists(dir))
            {
                throw new DirectoryNotFoundException(
                    $"ADR 0004 governs {governed} and it is not there. If the layout moved, move " +
                    "this list with it; a guard over a directory that does not exist passes on nothing.");
            }

            foreach (var file in Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(root, file).Replace(Path.DirectorySeparatorChar, '/');
                if (relative.Split('/').Any(segment => SkipDirs.Contains(segment))) continue;
                files.Add(file);
            }
        }

        return files;
    }

    private sealed record Hit(string File, int Line, string Rule, string Text);

    private static IReadOnlyList<Hit> Scan()
    {
        var root = RepoRoot();
        var hits = new List<Hit>();
        foreach (var file in GovernedFiles())
        {
            var relative = Path.GetRelativePath(root, file).Replace(Path.DirectorySeparatorChar, '/');
            var lines = File.ReadAllLines(file);
            for (var i = 0; i < lines.Length; i++)
            {
                // Comments are prose, and this repo's comments discuss the very
                // thing being forbidden — including this file. Scanning them would
                // make the guard fail on its own documentation.
                var code = lines[i];
                var slash = code.IndexOf("//", StringComparison.Ordinal);
                if (slash >= 0) code = code[..slash];
                if (code.TrimStart().StartsWith('*') || code.TrimStart().StartsWith("///")) continue;

                foreach (var (name, pattern) in Vocabulary)
                {
                    if (pattern.IsMatch(code))
                        hits.Add(new Hit(relative, i + 1, name, lines[i].Trim()));
                }
            }
        }

        return hits;
    }

    [Fact]
    public void The_scan_reached_the_code_it_claims_to_police()
    {
        // The control for everything below. A guard that found no files reports no
        // violations, which is the shape this repo has produced four times.
        var files = GovernedFiles();
        Assert.True(files.Count >= 40, $"only {files.Count} C# files under the governed roots");

        // And at least one file from each governed project, so a root that silently
        // stopped matching cannot hide behind the others' count.
        foreach (var governed in GovernedRoots)
        {
            Assert.Contains(files, f =>
                f.Replace(Path.DirectorySeparatorChar, '/')
                    .Contains(governed.Split('/')[^1], StringComparison.Ordinal));
        }
    }

    [Fact]
    public void Every_rule_in_the_vocabulary_can_actually_fire()
    {
        // A regex that matches nothing is an empty set, and two empty sets are
        // equal. Each rule is shown a line it MUST catch, so a pattern broken by a
        // later edit fails here rather than turning the real check green.
        var samples = new (string Rule, string Line)[]
        {
            ("trigonometry", "var y = Math.Atan(Math.Sinh(Math.PI * (1 - 2 * yTile / n)));"),
            ("pi", "const double Rad = Math.PI;"),
            ("log/exp (a Web-Mercator latitude needs both)", "var m = Math.Log(Math.Tan(lat));"),
            ("earth radius / mercator extent literal", "const double R = 6378137;"),
            ("degree<->radian conversion", "var rad = deg * Math.PI / 180;"),
            ("tiles per axis at zoom", "var n = 1 << zoom;"),
            ("2^zoom", "var n = Math.Pow(2, zoom);"),
            // The dull ones, sampled with exactly the code the probe wrote: a
            // metres-per-degree padder and a planar distance. Both passed 216/216
            // before these rules existed.
            ("metres per degree literal", "const double MetresPerDegreeLat = 111320.0;"),
            ("inch<->metre conversion literal", "var metres = inches * 0.0254;"),
            ("square root / hypotenuse (how a planar distance is spelled)",
                "return Math.Sqrt(dx * dx + dy * dy);"),
        };

        Assert.Equal(Vocabulary.Length, samples.Length);
        foreach (var (rule, line) in samples)
        {
            var pattern = Vocabulary.Single(v => v.Name == rule).Pattern;
            Assert.True(pattern.IsMatch(line), $"rule `{rule}` did not match its own sample: {line}");
        }
    }

    [Fact]
    public void No_geometry_is_reimplemented_in_C_sharp()
    {
        var offending = Scan()
            .Where(h => !Exempt.ContainsKey(h.File))
            .OrderBy(h => h.File, StringComparer.Ordinal)
            .ThenBy(h => h.Line)
            .ToList();

        Assert.True(
            offending.Count == 0,
            "ADR 0004: geometry lives in TypeScript `atlas-core` and is never reimplemented in C#. " +
            "Found:\n" +
            string.Join("\n", offending.Select(h => $"  {h.File}:{h.Line} [{h.Rule}] {h.Text}")) +
            "\n\nEither move the calculation into `packages/atlas-core` and reach it through the " +
            "render worker, or add the file to `Exempt` with the reason it is not projection, " +
            "scale or grid math. There is no third state.");
    }

    [Fact]
    public void No_exemption_has_gone_stale()
    {
        // An exemption for a file that no longer trips the scan is a recorded reason
        // for something that is not happening, and the next reader will believe it.
        var tripped = Scan().Select(h => h.File).ToHashSet(StringComparer.Ordinal);
        var stale = Exempt.Keys.Where(f => !tripped.Contains(f))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        Assert.True(
            stale.Count == 0,
            $"These files are exempted from the ADR 0004 scan and no longer trip it: " +
            $"{string.Join(", ", stale)}. Delete the entries — a stale reason is worse than none.");
    }
}

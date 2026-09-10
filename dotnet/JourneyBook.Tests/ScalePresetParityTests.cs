using System.Text.RegularExpressions;
using JourneyBook.Domain.Entities;
using JourneyBook.Infrastructure.Persistence;
using JourneyBook.Infrastructure.Persistence.Configurations;
using Microsoft.EntityFrameworkCore;

namespace JourneyBook.Tests;

/// <summary>
/// The scale-preset table exists twice: <c>SCALE_PRESETS</c> in
/// <c>packages/atlas-core/src/model.ts</c> — which CLAUDE.md names as the source
/// of truth — and the EF <c>HasData</c> seed in <c>ScalePresetConfiguration</c>,
/// whose comment claims "Seed matches SCALE_PRESETS" and which nothing checked.
///
/// The split matters because the two halves gate DIFFERENT ends of the same
/// request. Four user-facing write paths validate scale ids against the
/// **database** copy:
///
///   1. <c>ProjectService.EnsureScalePresetAsync</c> (project create AND update),
///   2. <c>LocationService.ValidateScalePresetAsync</c> (a location's override),
///   3. <c>LocationService.ValidateZoomLevelsAsync</c> (a zoom ladder),
///   4. the inline query in <c>LocationService.ImportCsvAsync</c>, which is a
///      fourth copy of the same lookup and routes through neither helper.
///
/// The engine then validates the SAME ids against the **TypeScript** copy
/// (<c>resolveScaleOrThrow</c> in <c>render.ts</c>). Add a preset to one side and
/// you get a project the API happily accepts and the renderer rejects with
/// "Unknown scalePresetId", classified into an HTTP status by prefix
/// string-matching in the worker. One test covers all four paths at once, because
/// all four ask the same table the same question.
///
/// Only <c>Id</c>, <c>Label</c> and <c>Ratio</c> are compared: those are the
/// persisted columns. <c>ScalePreset.panelWidthPx</c> on the TS side is an engine
/// print-resolution concern the API neither sends nor stores, and deliberately
/// has no column.
/// </summary>
public class ScalePresetParityTests
{
    private sealed record TsPreset(string Id, string Label, int Ratio);

    /// <summary>
    /// Parse the <c>SCALE_PRESETS</c> array out of the engine's <c>model.ts</c>.
    ///
    /// Reading the real file is the point: a C# literal listing the same five
    /// presets would be a FIFTH copy, and would pass for exactly as long as
    /// someone remembered to update it — the failure this test exists to catch.
    /// Every step refuses rather than degrades: a missing file, a missing array,
    /// or a parse that finds nothing all throw, because a parity test that
    /// silently compares an empty list to an empty list reports success while
    /// measuring nothing.
    /// </summary>
    private static IReadOnlyList<TsPreset> ParseTypeScriptPresets()
    {
        var path = RepoFile("packages/atlas-core/src/model.ts");
        var source = File.ReadAllText(path);

        var arrayMatch = Regex.Match(
            source,
            @"export\s+const\s+SCALE_PRESETS\s*:[^=]*=\s*\[(?<body>.*?)\]\s*as\s+const\s*;",
            RegexOptions.Singleline);
        if (!arrayMatch.Success)
        {
            throw new InvalidOperationException(
                $"Could not find the SCALE_PRESETS array literal in {path}. If it moved or changed " +
                "shape, fix this parser — do not let the parity check quietly pass on nothing.");
        }

        var entries = Regex.Matches(
            arrayMatch.Groups["body"].Value,
            """\{\s*id:\s*"(?<id>[^"]+)"\s*,\s*label:\s*"(?<label>[^"]+)"\s*,\s*ratio:\s*(?<ratio>\d+)""");

        var presets = entries
            .Select(m => new TsPreset(
                m.Groups["id"].Value,
                m.Groups["label"].Value,
                int.Parse(m.Groups["ratio"].Value)))
            .ToList();

        if (presets.Count == 0)
        {
            throw new InvalidOperationException(
                $"Found the SCALE_PRESETS array in {path} but parsed no entries out of it.");
        }

        return presets;
    }

    /// <summary>Resolve a repo-relative path by walking up from the test binary.</summary>
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

    /// <summary>
    /// The seed rows as EF will apply them. Built from the real
    /// <see cref="JourneyBookDbContext"/> model, so this reads
    /// <c>ScalePresetConfiguration.HasData</c> itself rather than a restatement of
    /// it. Building the model needs no connection, so this stays in the
    /// Docker-free unit job alongside the engine it is comparing against.
    /// </summary>
    private static IReadOnlyList<ScalePreset> SeededPresets()
    {
        // Run the real `ScalePresetConfiguration` — the file the seed lives in —
        // against a bare ModelBuilder and read the `HasData` rows back off the
        // model it produced. Not `dbContext.Model`: EF's runtime model is
        // read-optimised and does not carry seed data at all (it throws rather
        // than returning an empty list, which is the only reason the first
        // version of this test did not silently compare five presets to nothing).
        var modelBuilder = new ModelBuilder();
        var entity = modelBuilder.Entity<ScalePreset>();

        // A bare ModelBuilder carries no provider conventions, so it maps only the
        // properties something explicitly names — and `HasData` captures only
        // MAPPED properties. `ScalePresetConfiguration` names Id and Label but not
        // Ratio, so without this the seed rows come back with the ratio column
        // silently missing. Declared by reflection rather than by hand so a fourth
        // column on the entity is picked up here instead of being dropped.
        foreach (var property in typeof(ScalePreset).GetProperties())
        {
            entity.Property(property.PropertyType, property.Name);
        }

        new ScalePresetConfiguration().Configure(entity);

        var entityType = modelBuilder.Model.FindEntityType(typeof(ScalePreset))
            ?? throw new InvalidOperationException("ScalePreset is not in the EF model.");

        var expectedColumns = typeof(ScalePreset).GetProperties().Select(p => p.Name).ToHashSet();
        return entityType.GetSeedData()
            .Select(row =>
            {
                var missing = expectedColumns.Where(c => !row.ContainsKey(c)).ToList();
                if (missing.Count > 0)
                {
                    throw new InvalidOperationException(
                        $"Seed row is missing {string.Join(", ", missing)}. This test compares columns; " +
                        "a row that does not carry them all would compare nothing and report success.");
                }
                return new ScalePreset
                {
                    Id = (string)row[nameof(ScalePreset.Id)]!,
                    Label = (string)row[nameof(ScalePreset.Label)]!,
                    Ratio = (int)row[nameof(ScalePreset.Ratio)]!,
                };
            })
            .ToList();
    }

    [Fact]
    public void Both_sides_were_actually_read()
    {
        // The control for every comparison below. Two empty lists are equal, and
        // that is how a cross-language parity test comes to assert nothing at all.
        var ts = ParseTypeScriptPresets();
        var seeded = SeededPresets();
        Assert.True(ts.Count >= 5, $"parsed only {ts.Count} presets out of model.ts");
        Assert.True(seeded.Count >= 5, $"EF model carries only {seeded.Count} seeded presets");
    }

    [Fact]
    public void The_configuration_this_test_reads_is_the_one_the_DbContext_applies()
    {
        // Refusal machinery of a second kind. The seed above is read by running
        // `ScalePresetConfiguration` directly, which would still "pass" if that
        // class had been orphaned — `JourneyBookDbContext` picks up configurations
        // by assembly scan, so a rename or a moved namespace can quietly drop one.
        // Assert the context's own model carries the constraints only this
        // configuration sets, so the file under test is provably live.
        var options = new DbContextOptionsBuilder<JourneyBookDbContext>()
            .UseNpgsql("Host=unused;Database=unused", o => o.UseNetTopologySuite())
            .Options;
        using var db = new JourneyBookDbContext(options);

        var entityType = db.Model.FindEntityType(typeof(ScalePreset))
            ?? throw new InvalidOperationException("ScalePreset is not mapped by JourneyBookDbContext.");

        Assert.Equal("ScalePresets", entityType.GetTableName());
        Assert.Equal(32, entityType.FindProperty(nameof(ScalePreset.Id))!.GetMaxLength());
        Assert.Equal(64, entityType.FindProperty(nameof(ScalePreset.Label))!.GetMaxLength());
    }

    [Fact]
    public void Seeded_presets_match_the_engine_id_for_id()
    {
        var ts = ParseTypeScriptPresets().Select(p => p.Id).OrderBy(id => id, StringComparer.Ordinal);
        var seeded = SeededPresets().Select(p => p.Id).OrderBy(id => id, StringComparer.Ordinal);
        Assert.Equal(ts, seeded);
    }

    [Fact]
    public void Seeded_presets_match_the_engine_label_and_ratio()
    {
        var ts = ParseTypeScriptPresets().ToDictionary(p => p.Id);
        foreach (var row in SeededPresets())
        {
            Assert.True(ts.ContainsKey(row.Id), $"seeded preset '{row.Id}' has no entry in SCALE_PRESETS");
            Assert.Equal(ts[row.Id].Label, row.Label);
            Assert.Equal(ts[row.Id].Ratio, row.Ratio);
        }
    }

    [Fact]
    public void Engine_default_preset_id_is_one_the_database_actually_has()
    {
        // `RenderService` falls back to the literal "usgs-7-5-min" for a project
        // with no page grid, and `DEFAULT_SCALE_PRESET_ID` in the engine says the
        // same. If that row were ever dropped from the seed, every default render
        // would 400 from the worker with an "Unknown scalePresetId" the API had
        // no reason to expect.
        const string defaultId = "usgs-7-5-min";
        Assert.Contains(defaultId, SeededPresets().Select(p => p.Id));
        Assert.Contains(defaultId, ParseTypeScriptPresets().Select(p => p.Id));
    }
}

using System.Text.Json;
using System.Text.Json.Serialization;
using JourneyBook.Infrastructure.Locations;

namespace JourneyBook.Tests;

/// <summary>
/// The .NET half of a two-language conformance suite.
/// `packages/render-cli/src/locations-conformance.test.ts` is the other half and
/// reads the SAME file, `data/fixtures/locations-csv-cases.json`.
///
/// <see cref="LocationCsv.Parse"/> and `parseLocationsCsv` in the headless CLI are
/// two hand-written implementations of one format — same header aliases, same
/// quote handling, same all-or-nothing aggregation, near-identical error strings
/// — and both docblocks claim "one file works in both". Nothing checked it, and
/// it was false in four ways. Each side testing itself against its own
/// expectations is exactly how two parsers drift while both suites stay green,
/// so the expectations live in the fixture rather than in either language.
/// </summary>
public class LocationCsvConformanceTests
{
    private sealed record ExpectedRow(
        string Name,
        double Lng,
        double Lat,
        string? Notes,
        string? ScalePresetId,
        string? PinShape,
        string? PinColor,
        string[]? ZoomLevels);

    private sealed record Divergence(
        string TypeScript,
        string? TypeScriptRejectContains,
        [property: JsonPropertyName("dotnet")] string DotNet,
        string? Note);

    private sealed record Case(
        string Id,
        string Why,
        string Csv,
        string Expect,
        ExpectedRow[]? Rows,
        string? RejectContains,
        Divergence? Divergence);

    private sealed record Fixture(Case[] Cases);

    private static Fixture LoadFixture()
    {
        const string relative = "data/fixtures/locations-csv-cases.json";
        var suffix = relative.Replace('/', Path.DirectorySeparatorChar);
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, suffix);
            if (File.Exists(candidate))
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var fixture = JsonSerializer.Deserialize<Fixture>(File.ReadAllText(candidate), options)
                    ?? throw new InvalidOperationException($"{candidate} did not deserialize.");
                if (fixture.Cases.Length == 0)
                {
                    throw new InvalidOperationException($"{candidate} carries no cases.");
                }
                return fixture;
            }
            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            $"Could not find {relative} walking up from {AppContext.BaseDirectory}. This suite " +
            "compares two CSV parsers against a shared file; without it, it has no opinion.");
    }

    public static TheoryData<string> CaseIds()
    {
        var data = new TheoryData<string>();
        foreach (var c in LoadFixture().Cases) data.Add(c.Id);
        return data;
    }

    [Fact]
    public void Fixture_carries_every_case_class()
    {
        // The control. A missing or truncated fixture makes the theory below
        // enumerate nothing, and a theory with no rows is a green theory.
        var cases = LoadFixture().Cases;
        Assert.True(cases.Length >= 12, $"only {cases.Length} cases in the shared fixture");
        Assert.Contains(cases, c => c.Expect == "accept");
        Assert.Contains(cases, c => c.Expect == "reject");
        Assert.Contains(cases, c => c.Expect == "diverges");
    }

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void Matches_the_shared_fixture(string caseId)
    {
        var testCase = LoadFixture().Cases.Single(c => c.Id == caseId);
        var expected = testCase.Expect == "diverges" ? testCase.Divergence!.DotNet : testCase.Expect;

        if (expected == "accept")
        {
            var rows = LocationCsv.Parse(testCase.Csv);
            if (testCase.Rows is null)
            {
                Assert.NotEmpty(rows);
                return;
            }

            Assert.Equal(testCase.Rows.Length, rows.Count);
            for (int i = 0; i < rows.Count; i++)
            {
                var want = testCase.Rows[i];
                var got = rows[i];
                Assert.Equal(want.Name, got.Name);
                Assert.Equal(want.Lng, got.Lng, 9);
                Assert.Equal(want.Lat, got.Lat, 9);
                Assert.Equal(want.Notes, got.Notes);
                Assert.Equal(want.ScalePresetId, got.ScalePresetId);
                Assert.Equal(want.PinShape, got.PinShape);
                Assert.Equal(want.PinColor, got.PinColor);
                Assert.Equal(want.ZoomLevels, got.ZoomLevels);
            }
            return;
        }

        // Assert on the message, not merely that something threw: a parser that
        // throws for the wrong reason satisfies a bare Assert.Throws.
        var ex = Record.Exception(() => LocationCsv.Parse(testCase.Csv));
        Assert.True(ex is not null, $"\"{caseId}\" was accepted");
        var needle = testCase.Expect == "diverges"
            ? testCase.Divergence!.TypeScriptRejectContains
            : testCase.RejectContains;
        if (needle is not null)
        {
            Assert.Contains(needle, ex!.Message, StringComparison.OrdinalIgnoreCase);
        }
    }
}

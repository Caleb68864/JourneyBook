using System.Text.RegularExpressions;
using JourneyBook.Domain;
using JourneyBook.Domain.Entities;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace JourneyBook.Tests;

/// <summary>
/// <c>PdfStatus</c> exists twice: the C# enum in <c>JourneyBook.Domain/Enums.cs</c>,
/// which is what the database stores, and the <c>RenderStatus</c> union in
/// <c>apps/web/src/api/render-polling.ts</c>, which is what the polling client
/// branches on. Nothing compared them.
/// </summary>
/// <remarks>
/// <para>
/// This test exists because of a measurement that contradicted the brief it was
/// written under. The assumption going in was that adding a member to
/// <c>PdfStatus</c> needs a migration, and that
/// <c>harness/checks/migrations-current.sh</c> — the pending-model-changes gate in
/// CI — would catch a member added without one. <b>It does not, and cannot.</b>
/// <c>GeneratedPdfConfiguration</c> stores the column with
/// <c>HasConversion&lt;string&gt;()</c> and a length cap, and declares no check
/// constraint, so the relational model EF compares carries a <c>varchar(20)</c> and
/// no list of permitted values. A new member changes nothing EF can see.
/// </para>
/// <para>
/// Measured, not assumed: with the whole of this change in place and its migration
/// added, removing <c>PdfStatus.Cancelled</c> (and the one production reference to
/// it, so the solution still built) left the gate reporting
/// <c>PASS: the EF model matches the migration history.</c> The two states either
/// side both PASS. The gate is right about what it claims — it answers about
/// columns and seeds — and the enum simply is not one of the things it can answer
/// about.
/// </para>
/// <para>
/// So the member is guarded here instead, on the two things that can actually go
/// wrong with it: a name longer than the column, which fails at INSERT on a render
/// nobody can retry; and a member the web client has never heard of, which a
/// polling client treats as non-terminal and waits fifteen minutes for.
/// </para>
/// </remarks>
public class PdfStatusParityTests
{
    /// <summary>
    /// Parse the <c>RenderStatus</c> union out of the web client's real source.
    /// </summary>
    /// <remarks>
    /// Reading the file is the point — a C# list of the same four strings would be a
    /// third copy that passes for exactly as long as someone remembers it. Every
    /// step refuses rather than degrades: a missing file, a missing union or a parse
    /// that finds nothing all throw, because a parity test that compares an empty
    /// list to an empty list reports success while measuring nothing.
    /// </remarks>
    private static IReadOnlyList<string> ParseWebStatuses()
    {
        var path = WebClientContract.RenderPollingPath();
        var source = File.ReadAllText(path);

        var union = Regex.Match(
            source,
            @"export\s+type\s+RenderStatus\s*=\s*(?<body>[^;]+);",
            RegexOptions.Singleline);
        if (!union.Success)
        {
            throw new InvalidOperationException(
                $"Could not find the RenderStatus union in {path}. If it moved or changed shape, fix " +
                "this parser — do not let the parity check quietly pass on nothing.");
        }

        var names = Regex.Matches(union.Groups["body"].Value, "\"(?<name>[A-Za-z]+)\"")
            .Select(m => m.Groups["name"].Value)
            .ToList();

        if (names.Count == 0)
        {
            throw new InvalidOperationException(
                $"Found the RenderStatus union in {path} but parsed no members out of it.");
        }

        return names;
    }

    /// <summary>The status column's cap, read off the real model rather than restated.</summary>
    private static int StatusColumnMaxLength()
    {
        var options = new DbContextOptionsBuilder<JourneyBookDbContext>()
            .UseNpgsql("Host=unused;Database=unused", o => o.UseNetTopologySuite())
            .Options;
        using var db = new JourneyBookDbContext(options);

        var entityType = db.Model.FindEntityType(typeof(GeneratedPdf))
            ?? throw new InvalidOperationException("GeneratedPdf is not mapped by JourneyBookDbContext.");

        return entityType.FindProperty(nameof(GeneratedPdf.Status))?.GetMaxLength()
            ?? throw new InvalidOperationException(
                "GeneratedPdf.Status has no max length in the model, so this test has nothing to compare " +
                "against. That is a change to the configuration, not a reason to pass.");
    }

    [Fact]
    public void Both_sides_were_actually_read()
    {
        // The control for every comparison below. Two empty lists are equal, and
        // that is how a cross-language parity test comes to assert nothing at all.
        var web = ParseWebStatuses();
        var domain = Enum.GetNames<PdfStatus>();
        Assert.True(web.Count >= 4, $"parsed only {web.Count} statuses out of render-polling.ts");
        Assert.True(domain.Length >= 4, $"PdfStatus declares only {domain.Length} members");
    }

    [Fact]
    public void The_web_client_knows_every_status_the_database_can_store()
    {
        // A status the client has never seen is not a cosmetic gap: `waitForRender`
        // treats anything that is not Completed/Failed/Cancelled as still running, so
        // an unknown terminal status is a spinner that runs for the full fifteen
        // minutes and then reports a timeout that did not happen.
        var web = ParseWebStatuses().OrderBy(n => n, StringComparer.Ordinal);
        var domain = Enum.GetNames<PdfStatus>().OrderBy(n => n, StringComparer.Ordinal);
        Assert.Equal(domain, web);
    }

    /// <summary>
    /// The statuses the web client treats as terminal, parsed out of
    /// <c>TERMINAL_STATUSES</c> in its real source.
    /// </summary>
    private static IReadOnlyList<string> ParseWebTerminalStatuses()
    {
        var path = WebClientContract.RenderPollingPath();
        var source = File.ReadAllText(path);

        var decl = Regex.Match(
            source,
            @"TERMINAL_STATUSES\s*:\s*readonly\s+RenderStatus\[\]\s*=\s*\[(?<body>[^\]]*)\]",
            RegexOptions.Singleline);
        if (!decl.Success)
        {
            throw new InvalidOperationException(
                $"Could not find TERMINAL_STATUSES in {path}. If it moved or changed shape, fix this " +
                "parser — do not let the parity check quietly pass on nothing.");
        }

        var names = Regex.Matches(decl.Groups["body"].Value, "\"(?<name>[A-Za-z]+)\"")
            .Select(m => m.Groups["name"].Value)
            .ToList();
        if (names.Count == 0)
        {
            throw new InvalidOperationException(
                $"Found TERMINAL_STATUSES in {path} but parsed no members out of it.");
        }
        return names;
    }

    [Fact]
    public void The_two_languages_agree_on_which_statuses_are_terminal()
    {
        // Added because this exact gap shipped and cost a CI run. The terminal set was
        // written out by hand in four places; adding `Cancelled` updated three of them,
        // and the fourth — a test helper saying `"Completed" or "Failed"` — polled a
        // cancelled record for thirty seconds and reported a timeout that had not
        // happened. That is the failure the test below this one describes for a client
        // that has not heard of a status, and nothing was comparing the sets.
        var web = ParseWebTerminalStatuses().OrderBy(n => n, StringComparer.Ordinal).ToList();
        var domain = Enum.GetValues<PdfStatus>()
            .Where(s => s.IsTerminal())
            .Select(s => s.ToString())
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(domain, web);

        // Controls, both directions. Without the first, two empty lists are equal;
        // without the second, a set containing EVERYTHING is also "agreed" — and a
        // client that calls Pending terminal stops polling a render that has not
        // started.
        Assert.True(domain.Count >= 3, $"only {domain.Count} terminal statuses");
        Assert.DoesNotContain("Pending", domain);
        Assert.DoesNotContain("Rendering", domain);
        Assert.DoesNotContain("Pending", web);
        Assert.DoesNotContain("Rendering", web);
    }

    [Fact]
    public void The_in_flight_set_is_exactly_what_startup_reconciliation_looks_for()
    {
        // `FailStrandedAsync` cannot call `IsInFlight()` — EF has to translate its
        // predicate to SQL — so it writes `Pending || Rendering` out by hand. That copy
        // is what decides whether a crash-stranded row is ever cleared, and it is
        // pinned here rather than left to agree by inspection.
        var inFlight = Enum.GetValues<PdfStatus>()
            .Where(s => s.IsInFlight())
            .OrderBy(s => s)
            .ToList();
        Assert.Equal(new[] { PdfStatus.Pending, PdfStatus.Rendering }, inFlight);
    }

    [Fact]
    public void Every_status_name_fits_the_column_it_is_stored_in()
    {
        // The one failure mode the migration gate genuinely cannot see. The status is
        // persisted as its NAME, so a member longer than the cap is a render that
        // throws at the moment it tries to record its own outcome — the worst place
        // for it, because the record is then stuck in the state the write was meant
        // to move it out of.
        var max = StatusColumnMaxLength();
        foreach (var name in Enum.GetNames<PdfStatus>())
        {
            Assert.True(
                name.Length <= max,
                $"PdfStatus.{name} is {name.Length} characters and the column holds {max}.");
        }
    }
}

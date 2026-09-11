using System.Text.RegularExpressions;
using JourneyBook.Infrastructure.Rendering;

namespace JourneyBook.Tests;

/// <summary>
/// The render worker's <c>JobState</c> union and the states
/// <see cref="HttpRenderWorkerClient"/> handles must be the same set.
/// </summary>
/// <remarks>
/// <para>
/// <c>JobState</c> is declared once, in <c>services/render-worker/src/jobs.ts</c>,
/// and was copied as four case labels in one C# switch — the eighth hand-written
/// copy of a set in this repository, and the only one with nothing comparing it to
/// its source. <c>wire-contract.test.ts</c> pins the request body, not the job-state
/// vocabulary.
/// </para>
/// <para>
/// <b>The consequence was live, not latent.</b> The switch had no <c>default</c>, so
/// a state the API had never heard of fell through to the progress path and was read
/// as "still rendering". Measured before this test existed: rename <c>cancelled</c>
/// to <c>canceled</c> in the worker's union and its producer, and every cancel in the
/// product becomes a poll to the fifteen-minute deadline reported as a timeout —
/// which is precisely the confusion the job protocol was built to end — with
/// <b>216/216 .NET and 486/486 TS green</b>.
/// </para>
/// <para>
/// Naming the set on the C# side is half the fix. The instructive history is that a
/// previous pass consolidated six copies of a different terminal-status set and then
/// <b>added a seventh itself, four commits later</b>. Collapsing copies without
/// adding the thing that fails when a new one appears buys a week, not a fix. This is
/// that thing.
/// </para>
/// </remarks>
public class WorkerJobStateParityTests
{
    private const string JobsRelativePath = "services/render-worker/src/jobs.ts";

    /// <summary>
    /// Parse the <c>JobState</c> union out of the worker's real source.
    /// </summary>
    /// <remarks>
    /// Reading the file is the point — a C# list of the same four strings would be a
    /// ninth copy that agrees for exactly as long as someone remembers it. Every step
    /// refuses rather than degrades: a missing file, a missing union or a parse that
    /// finds nothing all throw, because a parity test comparing an empty list to an
    /// empty list reports success while measuring nothing.
    /// </remarks>
    private static IReadOnlyList<string> ParseWorkerJobStates()
    {
        var path = WebClientContract.RepoFile(JobsRelativePath);
        var source = File.ReadAllText(path);

        var union = Regex.Match(
            source,
            @"export\s+type\s+JobState\s*=\s*(?<body>[^;]+);",
            RegexOptions.Singleline);
        if (!union.Success)
        {
            throw new InvalidOperationException(
                $"Could not find the JobState union in {path}. If it moved or changed shape, fix this " +
                "parser — do not let the parity check quietly pass on nothing.");
        }

        var names = Regex.Matches(union.Groups["body"].Value, "\"(?<name>[A-Za-z-]+)\"")
            .Select(m => m.Groups["name"].Value)
            .ToList();
        if (names.Count == 0)
        {
            throw new InvalidOperationException(
                $"Found the JobState union in {path} but parsed no members out of it.");
        }

        return names;
    }

    [Fact]
    public void Both_sides_were_actually_read()
    {
        // The control for the comparison below. Two empty lists are equal, and that
        // is how a cross-language parity test comes to assert nothing at all.
        var worker = ParseWorkerJobStates();

        Assert.True(worker.Count >= 4, $"parsed only {worker.Count} states out of {JobsRelativePath}");
        Assert.True(
            HttpRenderWorkerClient.WorkerJobStates.All.Count >= 4,
            $"the client names only {HttpRenderWorkerClient.WorkerJobStates.All.Count} states");
    }

    [Fact]
    public void The_API_handles_every_state_the_worker_can_report()
    {
        var worker = ParseWorkerJobStates().OrderBy(n => n, StringComparer.Ordinal);
        var api = HttpRenderWorkerClient.WorkerJobStates.All.OrderBy(n => n, StringComparer.Ordinal);

        // Equality both ways on purpose. A state the worker can report and the API
        // cannot name is a render polled to its deadline; a state the API names and
        // the worker cannot report is dead handling that reads as coverage.
        Assert.Equal(worker, api);
    }

    [Fact]
    public void Exactly_one_of_them_is_the_state_a_job_is_still_in()
    {
        // The set means nothing without knowing which member is non-terminal: that
        // is the one the polling loop continues on, and every other member must end
        // the wait. Naming it here keeps the switch's `break` from being a silent
        // fifth behaviour nobody enumerated.
        Assert.Equal("rendering", HttpRenderWorkerClient.WorkerJobStates.Rendering);
        Assert.Equal(
            ["cancelled", "completed", "failed"],
            HttpRenderWorkerClient.WorkerJobStates.All
                .Where(s => s != HttpRenderWorkerClient.WorkerJobStates.Rendering)
                .OrderBy(s => s, StringComparer.Ordinal));
    }
}

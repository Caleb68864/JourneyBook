using System.Globalization;
using System.Text.RegularExpressions;

namespace JourneyBook.Tests;

/// <summary>
/// The web client's own source, read rather than restated.
/// </summary>
/// <remarks>
/// <para>
/// Several facts about this system are decided in TypeScript and enforced in C#:
/// the <c>RenderStatus</c> union, the terminal-status set, and the client's
/// deadline. Every one of them is a rule that has to agree with itself across a
/// language boundary with nothing making it agree — and each time one was written
/// out by hand on the C# side it drifted.
/// </para>
/// <para>
/// <b>The deadline is the instance this file was extracted for.</b> The fix that
/// raised <c>RenderWorker:TimeoutSeconds</c> from 120s to 900s added
/// <c>DependencyInjectionTests</c> to hold the two numbers together, and it did so
/// with <c>private static readonly TimeSpan ClientPatience = TimeSpan.FromMinutes(15)</c>
/// — a hand-copied mirror of <c>DEFAULT_TIMEOUT_MS</c>. Measured: change
/// <c>DEFAULT_TIMEOUT_MS</c> to 30 minutes and the assertion <c>900s &gt;= 900s</c>
/// still passes while the server cap is silently short again. That is the original
/// bug's exact shape, re-created inside its own fix, and the 15-minute figure had
/// reached four places before anything compared any two of them.
/// </para>
/// <para>
/// So the number is read out of the file that owns it. <c>PdfStatusParityTests</c>
/// already opened that same file for the status union, so the mechanism existed and
/// was simply not used for this. Every accessor here refuses rather than degrades: a
/// missing file, a missing declaration, or a right-hand side this parser cannot
/// evaluate all throw. A parity check that compares a default to a default reports
/// success while measuring nothing.
/// </para>
/// </remarks>
internal static class WebClientContract
{
    /// <summary>The polling client, which owns the status vocabulary and the deadline.</summary>
    internal const string RenderPollingRelativePath = "apps/web/src/api/render-polling.ts";

    /// <summary>Resolve a repo-relative path by walking up from the test binary.</summary>
    internal static string RepoFile(string relative)
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

    internal static string RenderPollingPath() => RepoFile(RenderPollingRelativePath);

    internal static string RenderPollingSource() => File.ReadAllText(RenderPollingPath());

    /// <summary>
    /// <c>DEFAULT_TIMEOUT_MS</c> from <c>render-polling.ts</c>: how long the browser
    /// waits for a render before giving up.
    /// </summary>
    /// <remarks>
    /// Written there as a product of literals (<c>15 * 60 * 1000</c>) because that is
    /// legible, so this evaluates a product of integer literals and nothing else. A
    /// right-hand side naming a constant, calling a function or doing arithmetic this
    /// does not understand throws — the alternative is a parser that silently returns
    /// some number it half-understood, which is worse than the hand-copy it replaced.
    /// </remarks>
    internal static TimeSpan ClientPatience()
    {
        var path = RenderPollingPath();
        var source = File.ReadAllText(path);

        var decl = Regex.Match(
            source,
            @"\bDEFAULT_TIMEOUT_MS\s*(?::\s*number\s*)?=\s*(?<body>[^;]+);",
            RegexOptions.Singleline);
        if (!decl.Success)
        {
            throw new InvalidOperationException(
                $"Could not find DEFAULT_TIMEOUT_MS in {path}. If it moved or changed shape, fix this " +
                "parser — do not let the deadline check quietly pass on a number nobody read.");
        }

        var body = decl.Groups["body"].Value.Trim();
        var factors = body.Split('*', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

        double ms = 1;
        foreach (var factor in factors)
        {
            if (!long.TryParse(factor, NumberStyles.None, CultureInfo.InvariantCulture, out var value))
            {
                throw new InvalidOperationException(
                    $"DEFAULT_TIMEOUT_MS in {path} is `{body}`, which this parser cannot evaluate: " +
                    $"`{factor}` is not an integer literal. It understands a product of integer " +
                    "literals (`15 * 60 * 1000`) and deliberately nothing else — teach it the new " +
                    "form rather than letting it guess.");
            }

            ms *= value;
        }

        if (ms <= 0)
        {
            throw new InvalidOperationException(
                $"DEFAULT_TIMEOUT_MS in {path} evaluates to {ms} ms, which is not a deadline.");
        }

        return TimeSpan.FromMilliseconds(ms);
    }
}

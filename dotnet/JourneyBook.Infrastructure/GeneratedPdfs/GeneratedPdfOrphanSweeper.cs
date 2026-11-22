using System.Text.RegularExpressions;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace JourneyBook.Infrastructure.GeneratedPdfs;

/// <summary>
/// Removes generated PDFs that no record points at: the leftovers no other path reaches
/// (a render the API stopped waiting for that the worker finished later, a worker that
/// outlived an API restart, and files orphaned before records kept their paths).
/// </summary>
/// <remarks>
/// <para>
/// Deliberately narrow, because a delete cannot be undone. A file is an orphan only when
/// ALL hold: it sits at the top of the generated dir; its name is the engine's own
/// <c>atlas-{32 hex}.pdf</c> (<c>RenderService</c>), so nothing an operator put there by
/// hand qualifies; it was last written at least <c>minAge</c> ago, longer than any render
/// runs; no record's <c>FilePath</c> names it; and no record has the id in its name, which
/// keeps a queued render whose row has not yet recorded a path.
/// </para>
/// <para>
/// Off by default (<c>GeneratedPdf:OrphanSweepMinAgeHours</c> = 0). Decided by agent
/// 2026-11-21 (owner may revisit): these files are unreachable through the app, but they
/// are still files on someone's disk.
/// </para>
/// </remarks>
public sealed partial class GeneratedPdfOrphanSweeper(JourneyBookDbContext db, GeneratedPdfArtifacts artifacts)
{
    [GeneratedRegex("^atlas-([0-9a-f]{32})\\.pdf$")]
    private static partial Regex AtlasFileName();

    /// <summary>Delete orphaned atlas PDFs at least <paramref name="minAge"/> old; returns how many.</summary>
    public async Task<int> SweepAsync(TimeSpan minAge, DateTime? utcNow = null, CancellationToken ct = default)
    {
        var dir = new DirectoryInfo(artifacts.Root);
        if (!dir.Exists) return 0;
        var now = utcNow ?? DateTime.UtcNow;

        var candidates = dir.EnumerateFiles()
            .Select(f => (File: f, Match: AtlasFileName().Match(f.Name)))
            .Where(c => c.Match.Success && now - c.File.LastWriteTimeUtc >= minAge)
            .ToList();
        if (candidates.Count == 0) return 0;

        var names = candidates.Select(c => c.File.Name).ToList();
        var ids = candidates.Select(c => Guid.ParseExact(c.Match.Groups[1].Value, "N")).ToList();
        var referenced = (await db.GeneratedPdfs
                .Where(g => g.FilePath != null && names.Contains(g.FilePath))
                .Select(g => g.FilePath!)
                .ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);
        var known = (await db.GeneratedPdfs
                .Where(g => ids.Contains(g.Id))
                .Select(g => g.Id)
                .ToListAsync(ct))
            .ToHashSet();

        var removed = 0;
        foreach (var (file, match) in candidates)
        {
            if (referenced.Contains(file.Name)) continue;
            if (known.Contains(Guid.ParseExact(match.Groups[1].Value, "N"))) continue;
            if (artifacts.TryDelete(file.Name)) removed++;
        }

        return removed;
    }
}

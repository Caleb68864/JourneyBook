using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Domain;
using JourneyBook.Domain.Entities;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace JourneyBook.Infrastructure.GeneratedPdfs;

/// <summary>
/// Stores generated-PDF lifecycle records and prunes expired ones. Rendering
/// itself stays in the TS render-cli engine (ADR 0004); this service only tracks
/// records. Retention (<c>RetentionDays</c>) and the artifact root
/// (<c>GeneratedDir</c>) are read from the <c>"GeneratedPdf"</c> configuration
/// section, defaulting to 30 days and <c>data/generated</c>.
/// </summary>
public class GeneratedPdfService : IGeneratedPdfService
{
    private readonly JourneyBookDbContext _db;
    private readonly int _retentionDays;
    private readonly string _generatedDir;

    public GeneratedPdfService(JourneyBookDbContext db, IConfiguration configuration)
    {
        _db = db;
        _retentionDays = int.TryParse(configuration["GeneratedPdf:RetentionDays"], out var days) ? days : 30;
        _generatedDir = configuration["GeneratedPdf:GeneratedDir"] is { Length: > 0 } dir ? dir : "data/generated";
    }

    public async Task<GeneratedPdfResponse?> CreateAsync(Guid projectId, CreateGeneratedPdfRequest request, CancellationToken ct = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, ct))
        {
            return null;
        }

        var createdAt = DateTimeOffset.UtcNow;
        var pdf = new GeneratedPdf
        {
            ProjectId = projectId,
            Status = PdfStatus.Pending,
            CreatedAt = createdAt,
            ExpiresAt = createdAt.AddDays(_retentionDays),
            SourceMetadataSnapshot = request.SourceMetadataSnapshot,
        };

        _db.GeneratedPdfs.Add(pdf);
        await _db.SaveChangesAsync(ct);
        return ToResponse(pdf);
    }

    public async Task<IReadOnlyList<GeneratedPdfResponse>?> ListAsync(Guid projectId, CancellationToken ct = default)
    {
        if (!await _db.Projects.AnyAsync(p => p.Id == projectId, ct))
        {
            return null;
        }

        var pdfs = await _db.GeneratedPdfs
            .Where(g => g.ProjectId == projectId)
            .OrderBy(g => g.CreatedAt)
            .ToListAsync(ct);
        return pdfs.Select(ToResponse).ToList();
    }

    public async Task<GeneratedPdfResponse?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var pdf = await _db.GeneratedPdfs.FirstOrDefaultAsync(g => g.Id == id, ct);
        return pdf is null ? null : ToResponse(pdf);
    }

    public async Task<GeneratedPdfResponse?> UpdateStatusAsync(Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default)
    {
        var pdf = await _db.GeneratedPdfs.FirstOrDefaultAsync(g => g.Id == id, ct);
        if (pdf is null) return null;

        pdf.Status = ParseStatus(request.Status);
        pdf.FilePath = request.FilePath;

        await _db.SaveChangesAsync(ct);
        return ToResponse(pdf);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var pdf = await _db.GeneratedPdfs.FirstOrDefaultAsync(g => g.Id == id, ct);
        if (pdf is null) return false;
        _db.GeneratedPdfs.Remove(pdf);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<int> PruneExpiredAsync(CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var expired = await _db.GeneratedPdfs
            .Where(g => g.ExpiresAt != null && g.ExpiresAt < now)
            .ToListAsync(ct);

        foreach (var pdf in expired)
        {
            TryDeleteArtifact(pdf.FilePath);
        }

        _db.GeneratedPdfs.RemoveRange(expired);
        await _db.SaveChangesAsync(ct);
        return expired.Count;
    }

    // --- helpers ----------------------------------------------------------

    /// <summary>
    /// Best-effort, path-confined delete of an on-disk artifact. The candidate
    /// path is resolved under <see cref="_generatedDir"/>; only files that
    /// actually resolve within that root are deleted, so a <c>../</c> traversal
    /// (or an absolute path) is skipped rather than deleted. A missing file or
    /// any IO error is swallowed — prune never throws on artifact cleanup.
    /// </summary>
    private void TryDeleteArtifact(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath)) return;

        try
        {
            var root = Path.GetFullPath(_generatedDir);
            // Anchor on a trailing separator so a sibling dir (e.g. "…/generated-evil")
            // cannot satisfy StartsWith("…/generated").
            var rootPrefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
            var resolved = Path.GetFullPath(Path.Combine(root, filePath));
            if (resolved.StartsWith(rootPrefix, StringComparison.Ordinal))
            {
                File.Delete(resolved);
            }
        }
        catch
        {
            // Best-effort: a missing file or traversal-confinement failure is ignored.
        }
    }

    private static PdfStatus ParseStatus(string value) =>
        Enum.TryParse<PdfStatus>(value, ignoreCase: true, out var status) && Enum.IsDefined(status)
            ? status
            : throw new ArgumentException($"Invalid PDF status '{value}'.", nameof(value));

    private static GeneratedPdfResponse ToResponse(GeneratedPdf g) =>
        new(
            g.Id,
            g.ProjectId,
            g.Status.ToString(),
            g.FilePath,
            g.CreatedAt,
            g.ExpiresAt,
            g.SourceMetadataSnapshot);
}

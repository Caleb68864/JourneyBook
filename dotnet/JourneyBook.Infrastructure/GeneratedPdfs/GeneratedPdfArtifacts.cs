using Microsoft.Extensions.Configuration;

namespace JourneyBook.Infrastructure.GeneratedPdfs;

/// <summary>
/// The generated-PDF files on disk, under <c>GeneratedPdf:GeneratedDir</c> (default
/// <c>data/generated</c>). One place for the path-confined delete, because three
/// callers need it: retention, deleting one record, and deleting a project (whose
/// records go by database cascade, which knows nothing about files).
/// </summary>
public sealed class GeneratedPdfArtifacts(IConfiguration configuration)
{
    private readonly string _generatedDir =
        configuration["GeneratedPdf:GeneratedDir"] is { Length: > 0 } dir ? dir : "data/generated";

    /// <summary>
    /// Best-effort, path-confined delete of an on-disk artifact. The candidate
    /// path is resolved under the generated dir; only files that actually resolve
    /// within that root are deleted, so a <c>../</c> traversal (or an absolute
    /// path) is skipped rather than deleted. A missing file or any IO error is
    /// swallowed: cleanup never throws.
    /// </summary>
    public void TryDelete(string? filePath)
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
}

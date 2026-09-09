using JourneyBook.Domain.Common;

namespace JourneyBook.Domain.Entities;

/// <summary>
/// A record of a generated atlas PDF, with a snapshot of the source metadata
/// (tile sources, attribution, scale) captured at render time.
/// </summary>
public class GeneratedPdf : EntityBase
{
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }

    public PdfStatus Status { get; set; } = PdfStatus.Pending;

    /// <summary>Server path to the rendered file once completed.</summary>
    public string? FilePath { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>JSON snapshot of source metadata at render time (jsonb).</summary>
    public string? SourceMetadataSnapshot { get; set; }

    /// <summary>When the generated file expires and may be purged.</summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    /// <summary>
    /// Why a <see cref="PdfStatus.Failed"/> render failed, in the renderer's own words.
    /// </summary>
    /// <remarks>
    /// Renders became asynchronous (POST returns 202 and the client polls), so the
    /// worker's diagnostic no longer has an HTTP response to ride home on: by the
    /// time the render fails the request that started it is long finished. Without
    /// somewhere to put it the user's whole answer is the word "Failed". Null for
    /// every status except <c>Failed</c>, and cleared on a subsequent success.
    /// </remarks>
    public string? ErrorMessage { get; set; }
}

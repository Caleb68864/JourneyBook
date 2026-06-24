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
}

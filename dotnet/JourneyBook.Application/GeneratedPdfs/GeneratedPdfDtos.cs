namespace JourneyBook.Application.GeneratedPdfs;

/// <summary>
/// Create a generated-PDF record for a project. <c>SourceMetadataSnapshot</c> is an
/// arbitrary client-supplied <c>jsonb</c> blob (e.g. render parameters or build info)
/// persisted as-is. On create the record starts as <c>Pending</c> and is assigned an
/// <c>ExpiresAt</c> from the configured retention window.
/// </summary>
public record CreateGeneratedPdfRequest(string? SourceMetadataSnapshot = null);

/// <summary>
/// Update the lifecycle status of a generated-PDF record. <c>Status</c> is parsed to
/// the <c>PdfStatus</c> enum (case-insensitive); <c>FilePath</c> records the artifact
/// location once the render completes.
/// </summary>
public record UpdateGeneratedPdfStatusRequest(string Status, string? FilePath = null);

/// <summary>A generated-PDF record as stored, including its retention window and metadata snapshot.</summary>
public record GeneratedPdfResponse(
    Guid Id,
    Guid ProjectId,
    string Status,
    string? FilePath,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt,
    string? SourceMetadataSnapshot);

/// <summary>Result of a manual prune: the number of expired records deleted.</summary>
public record PruneResult(int Deleted);

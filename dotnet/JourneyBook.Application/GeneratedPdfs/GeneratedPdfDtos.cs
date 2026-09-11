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
/// location once the render completes; <c>ErrorMessage</c> carries the renderer's
/// diagnostic for a <c>Failed</c> render and is cleared on any other status.
/// </summary>
public record UpdateGeneratedPdfStatusRequest(string Status, string? FilePath = null, string? ErrorMessage = null);

/// <summary>A generated-PDF record as stored, including its retention window and metadata snapshot.</summary>
public record GeneratedPdfResponse(
    Guid Id,
    Guid ProjectId,
    string Status,
    string? FilePath,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt,
    string? SourceMetadataSnapshot,
    // Why a Failed render failed. This is a polling client's only channel for the
    // diagnostic: the POST that started the render answered 202 long before the
    // failure happened, so there is no response left to carry it.
    string? ErrorMessage = null,
    // How far the render has got. Both null until the worker says otherwise, and
    // both meaningless without each other — `Progress` is a numerator. The polling
    // client reads them here because this record is the only channel a render that
    // outlives its own HTTP request has.
    int? Progress = null,
    int? PageCount = null,
    // What the engine says it is doing, in its own word. `Progress` counts finished
    // basemap PANELS, so it equals `PageCount` for the whole of PDF assembly and
    // stays 0 for a render with no basemap — both indistinguishable from a stall
    // without this.
    string? Phase = null);

/// <summary>
/// Report the worker's position on an in-flight render.
/// </summary>
/// <remarks>
/// Separate from <c>UpdateGeneratedPdfStatusRequest</c> on purpose: a progress
/// report is not a lifecycle transition, and routing it through the status writer
/// would mean every page re-asserted the status — one fumbled call away from a
/// terminal row being pushed back to <c>Rendering</c> by a late progress event.
/// </remarks>
public record UpdateGeneratedPdfProgressRequest(int Progress, int PageCount, string? Phase = null);

/// <summary>Result of a manual prune: the number of expired records deleted.</summary>
public record PruneResult(int Deleted);

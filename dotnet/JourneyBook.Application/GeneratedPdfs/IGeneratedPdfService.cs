namespace JourneyBook.Application.GeneratedPdfs;

/// <summary>
/// Use-cases for generated-PDF records within a project. A record tracks the
/// lifecycle of a rendered atlas artifact: it starts as <c>Pending</c> on create,
/// carries an arbitrary client-supplied <c>jsonb</c> metadata snapshot, and is
/// assigned an <c>ExpiresAt</c> from the configured retention window. Rendering
/// itself lives in the TS render-cli engine (ADR 0004); this service only stores
/// records and prunes expired ones.
/// </summary>
public interface IGeneratedPdfService
{
    /// <summary>
    /// Create a generated-PDF record within the given project. The record starts as
    /// <c>Pending</c> with <c>CreatedAt = UtcNow</c> and <c>ExpiresAt = CreatedAt +</c>
    /// the configured retention window. Returns <c>null</c> when the project does not
    /// exist (→ 404).
    /// </summary>
    Task<GeneratedPdfResponse?> CreateAsync(Guid projectId, CreateGeneratedPdfRequest request, CancellationToken ct = default);

    /// <summary>List the generated-PDF records for a project. Returns <c>null</c> when the project does not exist.</summary>
    Task<IReadOnlyList<GeneratedPdfResponse>?> ListAsync(Guid projectId, CancellationToken ct = default);

    /// <summary>Fetch a single generated-PDF record by id.</summary>
    Task<GeneratedPdfResponse?> GetAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Update the lifecycle status of a generated-PDF record. <c>Status</c> is parsed
    /// to the <c>PdfStatus</c> enum (case-insensitive) and <c>FilePath</c> is recorded
    /// for the artifact. Returns <c>null</c> when the record does not exist.
    /// </summary>
    Task<GeneratedPdfResponse?> UpdateStatusAsync(Guid id, UpdateGeneratedPdfStatusRequest request, CancellationToken ct = default);

    /// <summary>Delete a generated-PDF record. Returns <c>false</c> when the record does not exist.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Delete all records whose <c>ExpiresAt</c> is in the past, best-effort deleting
    /// each path-confined on-disk artifact, and return the number of records removed.
    /// </summary>
    Task<int> PruneExpiredAsync(CancellationToken ct = default);
}

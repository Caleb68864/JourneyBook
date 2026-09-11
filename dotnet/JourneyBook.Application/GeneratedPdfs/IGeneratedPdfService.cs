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

    /// <summary>
    /// Record how far an in-flight render has got. Returns <c>null</c> when the
    /// record does not exist.
    /// </summary>
    /// <remarks>
    /// Writes ONLY while the record is <c>Pending</c> or <c>Rendering</c>. A
    /// progress report that arrives after the render settled — the last poll racing
    /// the terminal write — must not touch a finished row, or a record can read
    /// "Completed" and "page 12 of 60" at the same time.
    /// </remarks>
    Task<GeneratedPdfResponse?> UpdateProgressAsync(Guid id, UpdateGeneratedPdfProgressRequest request, CancellationToken ct = default);

    /// <summary>Delete a generated-PDF record. Returns <c>false</c> when the record does not exist.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);

    /// <summary>
    /// Delete all records whose <c>ExpiresAt</c> is in the past, best-effort deleting
    /// each path-confined on-disk artifact, and return the number of records removed.
    /// </summary>
    Task<int> PruneExpiredAsync(CancellationToken ct = default);

    /// <summary>
    /// Mark every record still at <c>Pending</c> or <c>Rendering</c> as <c>Failed</c>,
    /// with <paramref name="reason"/> as its <c>ErrorMessage</c>, and return how many
    /// were changed.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is startup reconciliation, and it is sound only because the render queue is
    /// <b>in-process</b> (a <c>Channel</c> inside this host, ADR 0005): at the moment
    /// the host starts, nothing is rendering, so a row claiming to be
    /// <c>Pending</c> or <c>Rendering</c> is by definition wreckage from a previous
    /// process rather than work in flight. Running a second API instance against the
    /// same database would break that premise — it would fail the other instance's
    /// live renders — and would need a lease or an owner column first.
    /// </para>
    /// <para>
    /// The shutdown path (<c>RenderJobProcessor.FailQueuedJobsAsync</c>) already covers
    /// an orderly <c>SIGTERM</c>. It cannot cover a <c>SIGKILL</c>, an OOM kill, a
    /// container crash or power loss, and retention cannot either: <c>PruneExpiredAsync</c>
    /// only removes rows past their 30-day <c>ExpiresAt</c>, and a row stranded ten
    /// seconds ago is not expired. Without this, such a row sat at <c>Pending</c> for
    /// the full retention window while the client polled it 900 times and then told the
    /// user the render was still running.
    /// </para>
    /// </remarks>
    Task<int> FailStrandedAsync(string reason, CancellationToken ct = default);
}

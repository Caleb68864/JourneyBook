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

    /// <summary>Pages whose basemap panel the worker has finished, or null before it says.</summary>
    /// <remarks>
    /// Persisted rather than held in memory because the thing that reads it is
    /// <c>GET /api/generated-pdfs/{id}</c> — a scoped service over the database,
    /// with no view of the background loop. One UPDATE per page, on a render that
    /// takes minutes and is capped at <c>MAX_ATLAS_PAGES</c> pages, is a bounded
    /// cost for the only channel this record has.
    /// </remarks>
    public int? Progress { get; set; }

    /// <summary>Pages in the atlas the worker is rendering, or null before it knows.</summary>
    /// <remarks>
    /// The denominator. Without it <see cref="Progress"/> is a number with nothing
    /// to be a fraction of, and a progress bar cannot start.
    /// </remarks>
    public int? PageCount { get; set; }

    /// <summary>
    /// What the engine says it is doing: <c>contract</c>, <c>panel</c>,
    /// <c>overview</c>, <c>pdf</c> or <c>done</c>. Null before the worker says, and
    /// cleared when the record reaches a terminal status.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The engine has always reported this, the worker has always recorded it, the
    /// API's client has always parsed it into <c>RenderProgressUpdate.Phase</c> —
    /// and it stopped there, because <c>UpdateGeneratedPdfProgressRequest</c> had no
    /// member for it. Four hops and then no field: the margins shape, inside the
    /// commit that added the progress protocol.
    /// </para>
    /// <para>
    /// It is not decoration. <see cref="Progress"/> counts finished basemap PANELS,
    /// so at phase <c>pdf</c> it already equals <see cref="PageCount"/> and the bar
    /// sits at 100% for the whole of PDF assembly; and a render with the basemap off
    /// emits no panel events at all, so the bar sits at 0% from start to finish.
    /// Both of those look exactly like a stalled render, and this is the only field
    /// that can tell the user otherwise.
    /// </para>
    /// <para>
    /// Stored as the engine's own word rather than a status of our own: the API owns
    /// no rendering (ADR 0005), and that includes not inventing a vocabulary for
    /// what the renderer is doing.
    /// </para>
    /// </remarks>
    public string? Phase { get; set; }
}

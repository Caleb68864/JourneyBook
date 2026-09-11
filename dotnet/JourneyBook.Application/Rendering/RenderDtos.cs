using JourneyBook.Application.Common;

namespace JourneyBook.Application.Rendering;

/// <summary>Request body for POST /api/projects/{id}/render.</summary>
public record RenderProjectRequest(
    int Tier = 1,
    bool Route = false,
    bool IncludeLandmarks = true,
    bool TableOfContents = true,
    bool Overview = true,
    bool ReferenceGrid = true,
    bool Notes = true,
    // Tile a page grid over the box enclosing every saved location ("cover all my
    // stops"), prepended before the L# pages. Only meaningful for a project with
    // no saved extent - an extent already defines the grid, and the engine ignores
    // Cover in that case.
    bool Cover = false,
    // ── Basemap knobs ────────────────────────────────────────────────────────
    //
    // The engine and `render-cli` have carried all four of these since Stage 1E
    // (`--basemap`, `--panel-px`, `--panel-format`, `--panel-quality`); the API
    // carried none, so a headless-first project's own UI could reach less than
    // its CLI. `Basemap` in particular was not merely absent — it was HARDCODED
    // `true` in the wire payload, so every API render did a full tile fetch, the
    // slowest and most failure-prone part of the pipeline, with no way to ask for
    // a fast line-art preview.
    //
    // Defaults reproduce the previous behaviour EXACTLY: basemap on, and the
    // three panel knobs null so the engine keeps its own defaults (the per-preset
    // `ScalePreset.panelWidthPx`, JPEG, quality 90). Nothing here changes what an
    // existing caller gets; it only makes the trade-off reachable.
    //
    // PanelQuality/PanelFormat are the levers that actually move atlas size:
    // panel width is quantised by the Web-Mercator zoom the engine picks, so
    // raising it usually buys nothing until it crosses a zoom boundary and then
    // costs ~4x. Quality and format are continuous.
    bool Basemap = true,
    int? PanelWidthPx = null,
    string? PanelFormat = null,
    int? PanelQuality = null);

/// <summary>
/// Render-accepted response (202): the record id, its status at the moment of
/// acceptance (<c>Pending</c>), where the PDF will be once it exists, and where to
/// poll until it does.
/// </summary>
public record RenderProjectResponse(Guid GeneratedPdfId, string Status, string DownloadUrl, string StatusUrl);

/// <summary>Discriminated outcome from <see cref="IRenderService.RenderProjectAsync"/>.</summary>
/// <remarks>
/// There is no worker-failure outcome any more. The POST returns before the worker is
/// called, so a worker failure is not an outcome of the request that started it — it
/// lands on the record as <c>Failed</c> with an <c>ErrorMessage</c>, and the polling
/// client reads it there.
/// </remarks>
public enum RenderOutcome { Accepted, ProjectNotFound, InvalidParameters }

/// <summary>Outcome of <see cref="IRenderService.CancelRenderAsync"/>.</summary>
/// <remarks>
/// Four answers, not two, because "we could not cancel it" has three genuinely
/// different causes and telling them apart is the whole point of the feature. A
/// single false would produce the failure this codebase keeps finding: one
/// condition reported as another's.
/// </remarks>
public enum CancelRenderOutcome
{
    /// <summary>The cancellation reached the job; the record will settle at <c>Cancelled</c>.</summary>
    Requested,
    /// <summary>No such <c>GeneratedPdf</c> record (→ 404).</summary>
    NotFound,
    /// <summary>The record is already <c>Completed</c>, <c>Failed</c> or <c>Cancelled</c> (→ 409).</summary>
    AlreadyFinished,
    /// <summary>
    /// The record says it is in flight, but no job for it is registered in this
    /// process (→ 409).
    /// </summary>
    /// <remarks>
    /// The queue is in-process (ADR 0006), so a row that claims to be running with
    /// no job behind it is wreckage from a previous process that startup
    /// reconciliation should already have failed. Saying so is honest; silently
    /// marking the row cancelled would invent an outcome for a render this host
    /// never saw.
    /// </remarks>
    NotRunningHere,
}

/// <summary>Result of a cancel request, with the record's status if it was found.</summary>
public record CancelRenderResult(CancelRenderOutcome Outcome, string? Status = null);

/// <summary>Result returned by <see cref="IRenderService"/> to the endpoint handler.</summary>
public record RenderServiceResult(
    RenderOutcome Outcome,
    Guid? GeneratedPdfId = null,
    string? Status = null,
    string? DownloadUrl = null,
    string? Error = null,
    string? StatusUrl = null);

/// <summary>Payload sent to the render worker over HTTP.</summary>
public record RenderWorkerRequest(
    string ScalePresetId,
    int Tier,
    string Orientation,
    double Overlap,
    RenderMarginsDto Margins,
    BBoxDto? Extent,
    IReadOnlyList<RenderLocationDto> Locations,
    string OutputFileName,
    // Optional tile-proxy routing: when set, the worker fetches basemap tiles via
    // this api's Stage 3 proxy ({TileBaseUrl}/{TileSourceId}/{z}/{x}/{y}) instead of
    // hitting USGS directly. Null → worker fetches USGS directly.
    string? TileBaseUrl = null,
    string? TileSourceId = null,
    // Deepest zoom the tile source being proxied actually has, from the registered
    // `TileSource.MaxZoom`. The engine's docstring for this field names THIS caller
    // as the reason it exists — "needed when tiles come through the proxy from a
    // registered TileSource whose MaxZoom this process cannot see" — and the API
    // was the one caller not sending it, so the engine fell back to the ceiling
    // hardcoded for USGS Topo (16) whatever source was actually configured. Null
    // when no proxy is configured: the worker then fetches its own basemap and
    // knows its own ceiling.
    int? TileMaxZoom = null,
    // The book title printed in every page header, on the overview page, on the
    // contents page and in the PDF's own document metadata. This is the PROJECT'S
    // NAME — the one thing about an atlas the user typed themselves. There was no
    // member for it here, so `renderAtlasPdfToFile`'s `?? "Journey Book"` fallback
    // applied to every atlas the API has ever produced.
    string? Title = null,
    bool Route = false,
    // Persisted landmarks forwarded as additive vector furniture (camelCase
    // `landmarks` on the wire), gated by the include flag like Route.
    IReadOnlyList<RenderLandmarkDto>? Landmarks = null,
    bool IncludeLandmarks = false,
    // Prepend a locations table-of-contents page (camelCase `tableOfContents` on
    // the wire). Default true; false suppresses it.
    bool TableOfContents = true,
    // Front-matter overview page, reference-grid border, and notes area toggles
    // (camelCase `overview`/`referenceGrid`/`notes` on the wire). Default true.
    bool Overview = true,
    bool ReferenceGrid = true,
    bool Notes = true,
    // Cover extent: tile a grid over the box enclosing every location (camelCase
    // `cover` on the wire). Ignored by the engine when an extent/bbox is present.
    bool Cover = false,
    // Basemap knobs (camelCase `basemap`/`panelWidthPx`/`panelFormat`/
    // `panelQuality` on the wire). See RenderProjectRequest: `Basemap` used to be
    // a hardcoded `true` in HttpRenderWorkerClient and the three panel fields had
    // no member at all. The nullable ones are omitted from the wire entirely when
    // null (WhenWritingNull), so the engine falls back to its own defaults and a
    // payload built without them serializes byte-for-byte as it did before.
    bool Basemap = true,
    int? PanelWidthPx = null,
    string? PanelFormat = null,
    int? PanelQuality = null);

/// <summary>A single landmark forwarded to the render worker.</summary>
public record RenderLandmarkDto(double Longitude, double Latitude, string Name, string Category, double Score);

/// <summary>Safe margins (inches) forwarded to the render worker.</summary>
public record RenderMarginsDto(double Top, double Right, double Bottom, double Left, double Gutter = 0);


/// <summary>A single WGS84 coordinate forwarded to the render worker.</summary>
public record RenderLocationDto(
    double Longitude,
    double Latitude,
    string? Label = null,
    string? ScalePresetId = null,
    string? PinShape = null,
    string? PinColor = null,
    string? Notes = null,
    // Ordered zoom ladder (scale preset ids, coarse -> fine). The engine renders one
    // page per level as L#a, L#b, …; null/empty means a single page at ScalePresetId.
    IReadOnlyList<string>? ZoomLevels = null);

/// <summary>
/// The print resolution a finished render actually delivered, as the engine
/// measured it (<c>DeliveredDpi</c> in <c>packages/render-cli/src/render.ts</c>).
/// </summary>
/// <remarks>
/// <para>
/// This product's load-bearing promise is true scale, and this is the number that
/// says whether it was kept on a given render. It is not derivable from the
/// request: <c>renderMapPanel</c> crops at native tile resolution and never
/// resamples, so the requested panel width is a FLOOR and the delivered crop is
/// 1x-2x it depending on where the page falls relative to a Web-Mercator zoom
/// boundary. Two scale presets 4% apart print 1.9x apart in DPI.
/// </para>
/// <para>
/// A range, not one figure, because an atlas can mix scales — a zoom ladder puts
/// 1:100,000 and 1:24,000 in the same book — and the honest answer for such a
/// render is the spread. <see cref="Min"/> is the one that decides whether the
/// atlas met the target, because it is the softest page in it.
/// </para>
/// </remarks>
public record RenderDeliveredDpi(double Min, double Max, int Panels);

/// <summary>
/// Response from the render worker: output path, page count, optional attribution,
/// and the print resolution the render achieved.
/// </summary>
public record RenderWorkerResult(
    string OutputPath,
    int PageCount,
    string? Attribution,
    RenderDeliveredDpi? DeliveredDpi);

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
    RenderBBoxDto? Extent,
    IReadOnlyList<RenderLocationDto> Locations,
    string OutputFileName,
    // Optional tile-proxy routing: when set, the worker fetches basemap tiles via
    // this api's Stage 3 proxy ({TileBaseUrl}/{TileSourceId}/{z}/{x}/{y}) instead of
    // hitting USGS directly. Null → worker fetches USGS directly.
    string? TileBaseUrl = null,
    string? TileSourceId = null,
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

/// <summary>WGS84 bounding box forwarded to the render worker.</summary>
public record RenderBBoxDto(double West, double South, double East, double North);

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

/// <summary>Response from the render worker: output path, page count, and optional attribution.</summary>
public record RenderWorkerResult(string OutputPath, int PageCount, string? Attribution);

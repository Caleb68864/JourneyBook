using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using JourneyBook.Application.Rendering;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// Typed <see cref="HttpClient"/> that POSTs render jobs to the Node render-worker
/// service at the configured base URL.
/// </summary>
/// <remarks>
/// The worker's <c>POST /render</c> consumes the TS engine's <c>RenderAtlasInput</c>
/// contract — <c>{ mode, bbox|center, scalePresetId, tier, overlap, basemap, outputPath }</c>
/// (camelCase) — NOT the C# <see cref="RenderWorkerRequest"/> shape. This client maps
/// between the two so the API's domain request and the worker's wire contract stay
/// decoupled. A project with a persisted extent renders as a bbox grid; otherwise it
/// renders a single location page centred on the first saved location.
/// </remarks>
public class HttpRenderWorkerClient(HttpClient http) : IRenderWorkerClient
{
    private static readonly JsonSerializerOptions s_readOptions =
        new() { PropertyNameCaseInsensitive = true };

    private static readonly JsonSerializerOptions s_writeOptions =
        new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

    /// <summary>Wire payload matching the worker's <c>RenderAtlasInput</c> contract.</summary>
    private sealed record WorkerRenderPayload(
        string Mode,
        double[]? Bbox,
        WorkerCenter? Center,
        WorkerLocation[]? Locations,
        string ScalePresetId,
        int Tier,
        double Overlap,
        bool Basemap,
        string OutputPath,
        string? TileBaseUrl,
        string? TileSourceId,
        bool Route,
        // Optional additive landmark furniture (camelCase `landmarks`, omitted when
        // null). Forwarded only when the include-landmarks flag is set, like Route.
        WorkerLandmark[]? Landmarks,
        // Front-matter / furniture toggles (camelCase on the wire).
        bool TableOfContents,
        bool Overview,
        bool ReferenceGrid,
        bool Notes,
        // Tile a grid over the box enclosing every location. Only sent in "location"
        // mode - with a bbox the extent already defines the grid and the engine
        // ignores it, so sending false there keeps the payload self-consistent.
        bool Cover,
        // Page setup. These reach the engine's PageSpec, and the printed map box is
        // the printable area less the page furniture - so margins and the gutter
        // MOVE THE PRINTED FOOTPRINT, and with it the page count and the ground each
        // page covers. The project carried them faithfully through EF, validation,
        // the duplicate endpoint and the web adapter and then dropped them here;
        // every atlas printed at 0.5in portrait no matter what the user set.
        //
        // Orientation is lower-cased on the wire on purpose: the C# enum renders
        // "Portrait"/"Landscape", the TS `PageOrientation` union is
        // "portrait"|"landscape", and the renderer's own test is
        // `orientation === "landscape"` - so a raw ToString() would have made every
        // landscape project silently print portrait.
        string Orientation,
        WorkerMargins Margins,
        // Basemap panel knobs. These are nullable on purpose: `WhenWritingNull`
        // drops them from the body entirely, so an unset knob is an ABSENT wire
        // field and the engine applies its own default (the per-preset
        // `ScalePreset.panelWidthPx`, JPEG, quality 90) rather than receiving a
        // C# default that silently overrides it. Sending `panelWidthPx: 1000`
        // because `int` has no null would have flattened the per-preset print
        // widths added in `feat(atlas-core): give each scale preset the panel
        // width its own print needs` back to one global number.
        int? PanelWidthPx,
        string? PanelFormat,
        int? PanelQuality);

    private sealed record WorkerCenter(double Lng, double Lat);

    /// <summary>Safe margins (inches) + binder gutter → the engine's <c>PageMargins</c>.</summary>
    private sealed record WorkerMargins(double Top, double Right, double Bottom, double Left, double Gutter);

    /// <summary>A saved location → the worker's <c>RenderLocation</c> ({ center, label, scalePresetId, pin, notes, zoomLevels }).</summary>
    private sealed record WorkerLocation(
        WorkerCenter Center,
        string? Label,
        string? ScalePresetId,
        WorkerPin? Pin,
        string? Notes,
        // Ordered zoom ladder; omitted from the wire when null (WhenWritingNull) so a
        // location with no ladder serializes exactly as it did before.
        IReadOnlyList<string>? ZoomLevels);

    /// <summary>A location's custom pin → the worker's <c>{ shape, color }</c>.</summary>
    private sealed record WorkerPin(string? Shape, string? Color);

    /// <summary>A persisted landmark → the worker's landmark furniture ({ lng, lat, name, category, score }).</summary>
    private sealed record WorkerLandmark(double Lng, double Lat, string Name, string Category, double Score);

    /// <summary>
    /// The C# <c>PageOrientation</c> name ("Portrait") as the engine's
    /// <c>PageOrientation</c> union member ("portrait"). Anything unrecognised falls
    /// back to portrait — the engine would reject an unknown value outright, and a
    /// stray orientation string is not worth failing a render over.
    /// </summary>
    private static string ToWireOrientation(string orientation) =>
        string.Equals(orientation, "Landscape", StringComparison.OrdinalIgnoreCase)
            ? "landscape"
            : "portrait";

    private static WorkerMargins ToWireMargins(RenderMarginsDto m) =>
        new(m.Top, m.Right, m.Bottom, m.Left, m.Gutter);

    /// <summary>
    /// The panel format as the engine's <c>PanelFormat</c> union member.
    /// </summary>
    /// <remarks>
    /// Lower-cased for the same reason orientation is: the engine's union is
    /// <c>"jpeg" | "png"</c> and both the worker's JSON schema and
    /// <c>validateInput</c> compare exactly, so "JPEG" from a query string or a
    /// JSON body would be refused at the boundary. Null stays null — an absent
    /// field, not a default.
    /// </remarks>
    private static string? ToWirePanelFormat(string? format) =>
        format is null ? null : format.Trim().ToLowerInvariant();

    /// <summary>
    /// Translate the C# <see cref="RenderWorkerRequest"/> into the worker's
    /// <c>RenderAtlasInput</c> wire shape.
    /// </summary>
    private static WorkerRenderPayload ToWirePayload(RenderWorkerRequest request)
    {
        // Every saved location renders as its own fixed-scale L# page. They are
        // sent alongside the extent so a project with BOTH a bbox and locations
        // produces the grid pages PLUS one page per location (previously only the
        // bbox grid rendered and the locations were silently dropped).
        var locations = request.Locations.Count > 0
            ? request.Locations
                .Select(l => new WorkerLocation(
                    new WorkerCenter(l.Longitude, l.Latitude),
                    l.Label,
                    l.ScalePresetId,
                    l.PinShape is not null || l.PinColor is not null ? new WorkerPin(l.PinShape, l.PinColor) : null,
                    l.Notes,
                    l.ZoomLevels is { Count: > 0 } ? l.ZoomLevels : null))
                .ToArray()
            : null;

        // Landmarks are forwarded only when the project opted in (IncludeLandmarks),
        // mirroring how the Route flag gates the route overlay. Null → the wire
        // `landmarks` field is omitted entirely (WhenWritingNull).
        var landmarks = request is { IncludeLandmarks: true, Landmarks.Count: > 0 }
            ? request.Landmarks
                .Select(l => new WorkerLandmark(l.Longitude, l.Latitude, l.Name, l.Category, l.Score))
                .ToArray()
            : null;

        // Extent-driven (bbox grid) is the base when an extent exists; the
        // locations are appended. With no extent, render the locations alone
        // (mode "location"), passing the first as `center` for legacy validation.
        if (request.Extent is { } e)
        {
            return new WorkerRenderPayload(
                Mode: "bbox",
                Bbox: [e.West, e.South, e.East, e.North],
                Center: null,
                Locations: locations,
                ScalePresetId: request.ScalePresetId,
                Tier: request.Tier,
                Overlap: request.Overlap,
                Basemap: request.Basemap,
                OutputPath: request.OutputFileName,
                TileBaseUrl: request.TileBaseUrl,
                TileSourceId: request.TileSourceId,
                Route: request.Route,
                Landmarks: landmarks,
                TableOfContents: request.TableOfContents,
                Overview: request.Overview,
                ReferenceGrid: request.ReferenceGrid,
                Notes: request.Notes,
                // The extent IS the grid here; a cover extent would be redundant.
                Cover: false,
                Orientation: ToWireOrientation(request.Orientation),
                Margins: ToWireMargins(request.Margins),
                PanelWidthPx: request.PanelWidthPx,
                PanelFormat: ToWirePanelFormat(request.PanelFormat),
                PanelQuality: request.PanelQuality);
        }

        if (request.Locations.Count > 0)
        {
            var first = request.Locations[0];
            return new WorkerRenderPayload(
                Mode: "location",
                Bbox: null,
                Center: new WorkerCenter(first.Longitude, first.Latitude),
                Locations: locations,
                ScalePresetId: request.ScalePresetId,
                Tier: request.Tier,
                Overlap: request.Overlap,
                Basemap: request.Basemap,
                OutputPath: request.OutputFileName,
                TileBaseUrl: request.TileBaseUrl,
                TileSourceId: request.TileSourceId,
                Route: request.Route,
                Landmarks: landmarks,
                TableOfContents: request.TableOfContents,
                Overview: request.Overview,
                ReferenceGrid: request.ReferenceGrid,
                Notes: request.Notes,
                Cover: request.Cover,
                Orientation: ToWireOrientation(request.Orientation),
                Margins: ToWireMargins(request.Margins),
                PanelWidthPx: request.PanelWidthPx,
                PanelFormat: ToWirePanelFormat(request.PanelFormat),
                PanelQuality: request.PanelQuality);
        }

        throw new InvalidOperationException(
            "Cannot render: the project has neither an extent (bbox) nor any saved locations.");
    }

    public async Task<RenderWorkerResult> RenderAsync(RenderWorkerRequest request, CancellationToken ct = default)
    {
        var payload = ToWirePayload(request);

        HttpResponseMessage response;
        try
        {
            response = await http.PostAsJsonAsync("/render", payload, s_writeOptions, ct);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // HttpClient signals its OWN deadline as a TaskCanceledException, which is
            // an OperationCanceledException — indistinguishable, one catch further up,
            // from host shutdown. RenderJobRunner therefore told the user "the service
            // shut down or the job was aborted" when in fact nothing shut down and
            // nobody aborted: the API gave up on a healthy render.
            //
            // The caller's token is not cancelled here, so this can only be our own
            // deadline. Name it, and say which knob moves it — this is the one place
            // that knows the number.
            throw new TimeoutException(
                $"Render timed out: the render worker did not answer within {http.Timeout.TotalSeconds:0.##}s, " +
                "so the API stopped waiting. The render may still be running inside the worker. " +
                "Raise RenderWorker:TimeoutSeconds (RenderWorker__TimeoutSeconds) if large atlases legitimately take longer.");
        }

        using var owned = response;

        if (!response.IsSuccessStatusCode)
        {
            // Preserve the worker's diagnostic (e.g. {"error":"outputPath traversal
            // rejected"}) instead of the opaque "Response status code does not
            // indicate success" that EnsureSuccessStatusCode would throw.
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Render worker returned {(int)response.StatusCode}: {body}");
        }

        var result = await response.Content.ReadFromJsonAsync<RenderWorkerResult>(s_readOptions, ct);
        if (result is null)
            throw new InvalidOperationException("Render worker returned an empty or unparseable response.");

        return result;
    }
}

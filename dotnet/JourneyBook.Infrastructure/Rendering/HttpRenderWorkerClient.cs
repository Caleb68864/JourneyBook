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
public class HttpRenderWorkerClient(HttpClient http, RenderWorkerPollOptions? pollOptions = null)
    : IRenderWorkerClient
{
    private readonly RenderWorkerPollOptions _poll = pollOptions ?? new RenderWorkerPollOptions();

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
        // Nullable for the same reason the panel knobs are: an unset value must be
        // an ABSENT wire field so the engine keeps its own default, not a C# zero
        // that silently caps every panel at zoom 0.
        int? TileMaxZoom,
        // The atlas title. Nullable and omitted when null so a caller with no title
        // gets the engine's "Journey Book" fallback exactly as before, rather than
        // an empty string printed as the book's name.
        string? Title,
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
                TileMaxZoom: request.TileMaxZoom,
                Title: request.Title,
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
                TileMaxZoom: request.TileMaxZoom,
                Title: request.Title,
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

    /// <summary>The worker's job-state vocabulary, as one named set.</summary>
    /// <remarks>
    /// <para>
    /// The eighth hand-written copy of a set in this repository, and it was the four
    /// case labels of one switch with nothing enumerating them — so nothing could
    /// compare them to <c>JobState</c> in <c>services/render-worker/src/jobs.ts</c>,
    /// which is where the vocabulary is actually decided.
    /// <c>wire-contract.test.ts</c> pins the request body, not this.
    /// </para>
    /// <para>
    /// The lesson is the one that consolidating a set without adding the thing that
    /// fails on a new copy teaches: a previous pass collapsed six copies of the
    /// terminal-status set and then added a seventh itself, four commits later.
    /// Naming the set is half; <c>WorkerJobStateParityTests</c> is the half that
    /// fails when the two sides drift.
    /// </para>
    /// </remarks>
    public static class WorkerJobStates
    {
        public const string Rendering = "rendering";
        public const string Completed = "completed";
        public const string Failed = "failed";
        public const string Cancelled = "cancelled";

        /// <summary>Every state this client has been shown and made a decision about.</summary>
        public static readonly IReadOnlyList<string> All = [Rendering, Completed, Failed, Cancelled];
    }

    /// <summary>The worker's job record, as <c>GET /jobs/{id}</c> returns it (ADR 0007).</summary>
    private sealed record WorkerJob(
        string Id,
        string State,
        int Page,
        int PageCount,
        string? Phase,
        string? OutputPath,
        string? Attribution,
        RenderDeliveredDpi? DeliveredDpi,
        string? Error,
        string? ErrorKind);

    /// <summary>The 202 body from <c>POST /render</c>.</summary>
    private sealed record WorkerAccepted(string JobId, string State, string? StatusUrl);

    public async Task<RenderWorkerResult> RenderAsync(
        RenderWorkerRequest request,
        RenderProgressHandler? onProgress = null,
        CancellationToken ct = default)
    {
        var payload = ToWirePayload(request);

        // The overall render deadline, read off the HttpClient this type was
        // configured with rather than restated. Since the job protocol, no single
        // HTTP call here lasts a render — the POST accepts and each GET is a status
        // read — so without this the render would have no API-side bound at all.
        // Taking it from `http.Timeout` keeps ONE number: the one
        // `RenderWorker:TimeoutSeconds` sets, that `DependencyInjectionTests` pins
        // against the web client's own patience.
        var deadline = DateTimeOffset.UtcNow + http.Timeout;

        var accepted = await AcceptJobAsync(payload, ct);

        RenderProgressUpdate? lastReported = null;

        while (true)
        {
            // Ask before sleeping, so a job that finished during the last interval
            // is reported as finished rather than waited on again.
            WorkerJob job;
            try
            {
                job = await FetchJobAsync(accepted.JobId, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Someone asked us to stop. Tell the WORKER, or the render carries
                // on to completion and every tile it still needs is fetched for an
                // atlas nobody will be able to reach. This is the difference between
                // a cancel button and a button that hides the progress bar.
                await TryCancelJobAsync(accepted.JobId);
                throw;
            }

            switch (job.State)
            {
                case WorkerJobStates.Completed:
                    if (job.OutputPath is null)
                        throw new InvalidOperationException(
                            $"Render worker job {job.Id} reported completed with no output path.");
                    return new RenderWorkerResult(
                        job.OutputPath, job.PageCount, job.Attribution, job.DeliveredDpi);

                case WorkerJobStates.Cancelled:
                    // Its own exception type, not an OperationCanceledException: an
                    // HttpClient deadline throws one of those too, and conflating
                    // them is exactly how a timeout came to be reported to users as
                    // a cancellation.
                    throw new RenderCancelledException(
                        job.Error ?? $"Render worker job {job.Id} was cancelled.");

                case WorkerJobStates.Failed:
                    throw new InvalidOperationException(
                        $"Render worker failed ({job.ErrorKind ?? "unknown"}): {job.Error ?? "no diagnostic"}");

                case WorkerJobStates.Rendering:
                    // The only non-terminal state. Fall out of the switch to the
                    // progress report and the next poll.
                    break;

                default:
                    // There was no default here, so a state this API has never heard
                    // of fell straight through to the progress path and was read as
                    // "still rendering" — which means polling it to the fifteen-minute
                    // deadline and then reporting the timeout that this whole protocol
                    // exists to tell APART from a cancellation. Measured: rename
                    // `cancelled` to `canceled` in the worker's `JobState` union and
                    // every cancel in the product becomes exactly that, with 216/216
                    // and 486/486 green.
                    //
                    // Failing loudly is the lesser harm. A worker deployed ahead of
                    // the API produces one clearly-explained failed record instead of
                    // a quarter-hour spinner ending in an untrue diagnostic.
                    throw new InvalidOperationException(
                        $"Render worker job {job.Id} reported state '{job.State}', which this API has " +
                        $"no handling for. Known states: {string.Join(", ", WorkerJobStates.All)}. " +
                        "The worker's `JobState` union (services/render-worker/src/jobs.ts) and this " +
                        "switch have drifted — most likely a worker deployed ahead of the API.");
            }

            if (onProgress is not null && job.PageCount > 0)
            {
                var update = new RenderProgressUpdate(job.Page, job.PageCount, job.Phase ?? "rendering");
                if (update != lastReported)
                {
                    lastReported = update;
                    // Awaited, not fired: see RenderProgressHandler. The handler
                    // writes a row, and an unordered write racing the terminal
                    // status is a record that says "Completed" and "page 12" at once.
                    await onProgress(update, ct);
                }
            }

            if (DateTimeOffset.UtcNow >= deadline)
            {
                await TryCancelJobAsync(accepted.JobId);
                throw new TimeoutException(
                    $"Render timed out: the render worker was still on page {job.Page} of {job.PageCount} " +
                    $"after {http.Timeout.TotalSeconds:0.##}s, so the API stopped waiting and cancelled the job. " +
                    "Raise RenderWorker:TimeoutSeconds (RenderWorker__TimeoutSeconds) if large atlases legitimately take longer.");
            }

            try
            {
                await Task.Delay(_poll.Interval, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                await TryCancelJobAsync(accepted.JobId);
                throw;
            }
        }
    }

    private async Task<WorkerAccepted> AcceptJobAsync(WorkerRenderPayload payload, CancellationToken ct)
    {
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
                $"Render timed out before it started: the render worker did not accept the job within " +
                $"{http.Timeout.TotalSeconds:0.##}s, so the API stopped waiting. " +
                "Raise RenderWorker:TimeoutSeconds (RenderWorker__TimeoutSeconds) if the worker is legitimately that slow to answer.");
        }

        using var owned = response;

        if (!response.IsSuccessStatusCode)
        {
            // Preserve the worker's diagnostic (e.g. {"error":"outputPath traversal
            // rejected"}) instead of the opaque "Response status code does not
            // indicate success" that EnsureSuccessStatusCode would throw. Everything
            // the worker can judge before a job exists still answers here — the
            // schema, the tile-URL policy, outputPath confinement and the engine's
            // own contract assembly (ADR 0007).
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Render worker returned {(int)response.StatusCode}: {body}");
        }

        var accepted = await response.Content.ReadFromJsonAsync<WorkerAccepted>(s_readOptions, ct);
        if (accepted is null || string.IsNullOrWhiteSpace(accepted.JobId))
            throw new InvalidOperationException(
                "Render worker accepted the render without returning a job id, so there is nothing to follow.");

        return accepted;
    }

    private async Task<WorkerJob> FetchJobAsync(string jobId, CancellationToken ct)
    {
        using var response = await http.GetAsync($"/jobs/{jobId}", ct);

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // The worker has no record of a job it accepted. It restarted, or the
            // job outlived its retention. Either way the render is not happening and
            // is not coming back — and saying so is the honest answer, where waiting
            // would poll a job that no longer exists until the deadline.
            throw new InvalidOperationException(
                $"Render worker no longer has job {jobId}. The worker restarted, so the render is gone; generate the atlas again.");
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Render worker returned {(int)response.StatusCode} polling job {jobId}: {body}");
        }

        return await response.Content.ReadFromJsonAsync<WorkerJob>(s_readOptions, ct)
            ?? throw new InvalidOperationException($"Render worker returned an unreadable record for job {jobId}.");
    }

    /// <summary>
    /// Best-effort <c>DELETE /jobs/{id}</c>: stop the worker rendering something
    /// nobody is waiting for any more.
    /// </summary>
    /// <remarks>
    /// On <see cref="CancellationToken.None"/> deliberately — this runs precisely
    /// when the caller's token has just been cancelled, and issuing the stop on that
    /// token would cancel the stop. Failures are swallowed: we are already on the
    /// way out, and an exception here would replace the real reason for stopping
    /// with a secondary one, which is this codebase's recurring failure shape.
    /// </remarks>
    private async Task TryCancelJobAsync(string jobId)
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            using var _ = await http.DeleteAsync($"/jobs/{jobId}", cts.Token);
        }
        catch
        {
            // Best effort.
        }
    }
}

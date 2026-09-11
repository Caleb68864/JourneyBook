using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// Accepts a render: resolves the project graph, creates a Pending
/// <c>GeneratedPdf</c> record, and hands the built worker request to
/// <see cref="IRenderJobQueue"/>. It does not wait for the render.
/// </summary>
/// <remarks>
/// This used to block the HTTP request for the whole render. A 60-page atlas is 60
/// sequential basemap fetches, so the browser sat on one open connection behind an
/// indefinite spinner for minutes, and any proxy or client timeout in between turned a
/// perfectly good render into a failed request. Now the POST answers 202 with the
/// record id and the client polls <c>GET /api/generated-pdfs/{id}</c> — which already
/// existed, and already reported a status nothing was moving.
/// </remarks>
public class RenderService(
    JourneyBookDbContext db,
    IGeneratedPdfService pdfService,
    IRenderJobQueue jobQueue,
    IRenderCancellationRegistry cancellations,
    IConfiguration configuration,
    ILogger<RenderService> logger) : IRenderService
{
    public async Task<RenderServiceResult> RenderProjectAsync(
        Guid projectId,
        RenderProjectRequest request,
        CancellationToken ct = default)
    {
        // 1. Validate tier early (avoids creating a DB record for a bad request).
        if (request.Tier < 1 || request.Tier > 4)
            return new RenderServiceResult(RenderOutcome.InvalidParameters,
                Error: $"Tier must be 1–4, got {request.Tier}.");

        // 1b. Validate the basemap panel knobs against the SAME bounds the engine
        //     and the worker's JSON schema use (render.ts validateInput /
        //     renderBodySchema). Deliberately not stricter: three components with
        //     three definitions of a valid request is how a legitimate input gets
        //     refused by whichever one is tightest. Checked here, before the
        //     Pending lifecycle record exists, so a typo is a 400 on the POST
        //     rather than a queued job that fails minutes later and leaves a
        //     Failed row the user has to go and read.
        if (RenderPanelKnobs.Validate(request) is { } knobError)
            return new RenderServiceResult(RenderOutcome.InvalidParameters, Error: knobError);

        // 2. Resolve project with PageGrid + Extent + Locations + Landmarks.
        var project = await db.Projects
            .Include(p => p.PageGrid)
            .Include(p => p.Extent)
            .Include(p => p.Locations)
            .Include(p => p.Landmarks)
            .FirstOrDefaultAsync(p => p.Id == projectId, ct);

        if (project is null)
            return new RenderServiceResult(RenderOutcome.ProjectNotFound);

        // Nothing to render: no extent (bbox grid) and no saved locations (location
        // page). This is a user error (400), not a worker failure (502) — reject it
        // before creating a Pending lifecycle record we'd only have to fail.
        if (project.Extent?.Bounds is null && project.Locations.Count == 0)
            return new RenderServiceResult(RenderOutcome.InvalidParameters,
                Error: "Project has no extent and no locations — nothing to render. Set a bounding box or add a location first.");

        var grid = project.PageGrid;
        var scalePresetId = grid?.ScalePresetId ?? "usgs-7-5-min";
        var orientation = grid?.Orientation.ToString() ?? "Portrait";
        var overlap = grid?.Overlap ?? 0;
        var margins = grid?.Margins is { } m
            ? new RenderMarginsDto(m.Top, m.Right, m.Bottom, m.Left, m.Gutter)
            : new RenderMarginsDto(0.5, 0.5, 0.5, 0.5);

        // 3. Create the Pending lifecycle record.
        var created = await pdfService.CreateAsync(projectId, new CreateGeneratedPdfRequest(), ct);
        if (created is null)
            return new RenderServiceResult(RenderOutcome.ProjectNotFound);

        var outputFileName = $"atlas-{created.Id:N}.pdf";

        // 4. Build the worker request.
        RenderBBoxDto? extent = null;
        if (project.Extent?.Bounds is { } bounds)
        {
            var env = bounds.EnvelopeInternal;
            extent = new RenderBBoxDto(env.MinX, env.MinY, env.MaxX, env.MaxY);
        }

        var locations = project.Locations
            .Select(l => new RenderLocationDto(
                l.Location.X, l.Location.Y, l.Name, l.ScalePresetId, l.PinShape, l.PinColor, l.Notes, l.ZoomLevels))
            .ToList();

        // Persisted landmarks forwarded as additive vector furniture, carried like
        // the Route flag. The caller's IncludeLandmarks toggle gates the forward, so
        // a user can generate a clean map without their imported landmarks; a project
        // with none renders exactly as before regardless of the flag.
        var landmarks = request.IncludeLandmarks
            ? project.Landmarks
                .Select(lm => new RenderLandmarkDto(
                    lm.Location.X, lm.Location.Y, lm.Name, lm.Category.ToString(), lm.Score))
                .ToList()
            : new List<RenderLandmarkDto>();

        // Route the worker's basemap tile fetches through THIS api's Stage 3 tile
        // proxy (one tile path: shared disk cache, attribution, and PMTiles support)
        // when configured. When unset (e.g. a bare `dotnet run` with no worker), the
        // worker falls back to fetching USGS directly.
        var tileProxyBaseUrl = configuration["Tiles:ProxyBaseUrl"] is { Length: > 0 } u ? u : null;
        var tileSourceId = configuration["Tiles:DefaultSource"] is { Length: > 0 } s ? s : "usgs-topo";

        var workerReq = new RenderWorkerRequest(
            ScalePresetId: scalePresetId,
            Tier: request.Tier,
            Orientation: orientation,
            Overlap: overlap,
            Margins: margins,
            Extent: extent,
            Locations: locations,
            OutputFileName: outputFileName,
            TileBaseUrl: tileProxyBaseUrl,
            TileSourceId: tileProxyBaseUrl is null ? null : tileSourceId,
            Route: request.Route,
            Landmarks: landmarks,
            IncludeLandmarks: landmarks.Count > 0,
            TableOfContents: request.TableOfContents,
            Overview: request.Overview,
            ReferenceGrid: request.ReferenceGrid,
            Notes: request.Notes,
            Cover: request.Cover,
            // Basemap knobs straight through. `Basemap` was a hardcoded `true`
            // one layer down, so an API caller could not ask for the fast
            // no-tiles preview the CLI has had since Stage 1E; the three panel
            // fields had no member anywhere on this path at all.
            Basemap: request.Basemap,
            PanelWidthPx: request.PanelWidthPx,
            PanelFormat: request.PanelFormat,
            PanelQuality: request.PanelQuality);

        // 5. Register the cancel channel BEFORE queueing, so there is no window in
        //    which an accepted render cannot be cancelled. A job can wait behind
        //    another for minutes; registering when the runner picks it up would
        //    answer "not running here" for exactly the period a user is most likely
        //    to change their mind.
        cancellations.Register(created.Id);

        // 6. Queue it and answer. Deliberately CancellationToken.None: `ct` is the
        //    HTTP request's, and the request is about to end — cancelling the enqueue
        //    on it would drop the job the client has just been told is accepted.
        //    (The unbounded channel never blocks, so this cannot hang.)
        await jobQueue.EnqueueAsync(new RenderJob(created.Id, projectId, workerReq), CancellationToken.None);

        logger.LogInformation(
            "Queued render for project {ProjectId} as {GeneratedPdfId}", projectId, created.Id);

        return new RenderServiceResult(
            RenderOutcome.Accepted,
            created.Id,
            "Pending",
            DownloadUrl: $"/api/generated-pdfs/{created.Id}/content",
            StatusUrl: $"/api/generated-pdfs/{created.Id}");
    }

    /// <inheritdoc />
    public async Task<CancelRenderResult> CancelRenderAsync(Guid generatedPdfId, CancellationToken ct = default)
    {
        var record = await pdfService.GetAsync(generatedPdfId, ct);
        if (record is null) return new CancelRenderResult(CancelRenderOutcome.NotFound);

        // Already over. Answering "cancelled" here would be the same class of lie as
        // reporting a timeout as a cancellation: nothing was stopped, and a client
        // that is told otherwise will wait for a transition that never comes.
        if (record.Status is "Completed" or "Failed" or "Cancelled")
            return new CancelRenderResult(CancelRenderOutcome.AlreadyFinished, record.Status);

        // The queue is in-process (ADR 0006), so a row claiming to be in flight with
        // no registered job is wreckage from a previous process — which startup
        // reconciliation should already have failed. Say that, rather than marking
        // the row Cancelled and inventing an outcome for a render this host never saw.
        if (!cancellations.Cancel(generatedPdfId))
            return new CancelRenderResult(CancelRenderOutcome.NotRunningHere, record.Status);

        logger.LogInformation("Cancel requested for render {GeneratedPdfId}", generatedPdfId);

        // Requested, not done. The runner writes the terminal status when the render
        // actually stops — for a running job that is one worker DELETE away, and the
        // client sees it on its next poll. Reporting it as finished here would put a
        // status on the wire that the record does not yet carry.
        return new CancelRenderResult(CancelRenderOutcome.Requested, record.Status);
    }
}

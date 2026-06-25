using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// Orchestrates a render: resolves the project graph, creates a Pending
/// <c>GeneratedPdf</c> record, delegates the render call to
/// <see cref="IRenderWorkerClient"/>, then marks the record Completed or Failed.
/// </summary>
public class RenderService(
    JourneyBookDbContext db,
    IGeneratedPdfService pdfService,
    IRenderWorkerClient workerClient,
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

        // 2. Resolve project with PageGrid + Extent + Locations.
        var project = await db.Projects
            .Include(p => p.PageGrid)
            .Include(p => p.Extent)
            .Include(p => p.Locations)
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
            .Select(l => new RenderLocationDto(l.Location.X, l.Location.Y, l.Name, l.ScalePresetId))
            .ToList();

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
            TileSourceId: tileProxyBaseUrl is null ? null : tileSourceId);

        // 5. Invoke the worker; mark Completed or Failed.
        try
        {
            var result = await workerClient.RenderAsync(workerReq, ct);
            await pdfService.UpdateStatusAsync(
                created.Id,
                new UpdateGeneratedPdfStatusRequest("Completed", result.OutputPath),
                ct);

            var downloadUrl = $"/api/generated-pdfs/{created.Id}/content";
            return new RenderServiceResult(RenderOutcome.Success, created.Id, "Completed", downloadUrl);
        }
        catch (OperationCanceledException)
        {
            // Client disconnected / request aborted — not a worker failure. Mark the
            // record Failed (best effort, with a token that won't itself be cancelled)
            // and let the cancellation propagate.
            await pdfService.UpdateStatusAsync(
                created.Id, new UpdateGeneratedPdfStatusRequest("Failed"), CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Render worker failed for project {ProjectId} (pdf {GeneratedPdfId})",
                projectId, created.Id);
            await pdfService.UpdateStatusAsync(
                created.Id,
                new UpdateGeneratedPdfStatusRequest("Failed"),
                CancellationToken.None);
            return new RenderServiceResult(RenderOutcome.WorkerFailed, created.Id, Error: ex.Message);
        }
    }
}

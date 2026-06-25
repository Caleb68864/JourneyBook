namespace JourneyBook.Application.Rendering;

/// <summary>Request body for POST /api/projects/{id}/render.</summary>
public record RenderProjectRequest(int Tier = 1, bool Route = false);

/// <summary>Successful render response (200): generated PDF id, status, and download URL.</summary>
public record RenderProjectResponse(Guid GeneratedPdfId, string Status, string DownloadUrl);

/// <summary>Worker-failure render response (502): generated PDF id and error message.</summary>
public record RenderFailedResponse(Guid GeneratedPdfId, string Error);

/// <summary>Discriminated outcome from <see cref="IRenderService.RenderProjectAsync"/>.</summary>
public enum RenderOutcome { Success, ProjectNotFound, InvalidParameters, WorkerFailed }

/// <summary>Result returned by <see cref="IRenderService"/> to the endpoint handler.</summary>
public record RenderServiceResult(
    RenderOutcome Outcome,
    Guid? GeneratedPdfId = null,
    string? Status = null,
    string? DownloadUrl = null,
    string? Error = null);

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
    bool Route = false);

/// <summary>Safe margins (inches) forwarded to the render worker.</summary>
public record RenderMarginsDto(double Top, double Right, double Bottom, double Left, double Gutter = 0);

/// <summary>WGS84 bounding box forwarded to the render worker.</summary>
public record RenderBBoxDto(double West, double South, double East, double North);

/// <summary>A single WGS84 coordinate forwarded to the render worker.</summary>
public record RenderLocationDto(double Longitude, double Latitude, string? Label = null, string? ScalePresetId = null);

/// <summary>Response from the render worker: output path, page count, and optional attribution.</summary>
public record RenderWorkerResult(string OutputPath, int PageCount, string? Attribution);

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
        string ScalePresetId,
        int Tier,
        double Overlap,
        bool Basemap,
        string OutputPath);

    private sealed record WorkerCenter(double Lng, double Lat);

    /// <summary>
    /// Translate the C# <see cref="RenderWorkerRequest"/> into the worker's
    /// <c>RenderAtlasInput</c> wire shape.
    /// </summary>
    private static WorkerRenderPayload ToWirePayload(RenderWorkerRequest request)
    {
        // Extent-driven (bbox grid) takes precedence; otherwise scale-driven
        // (single location page) from the first saved location.
        if (request.Extent is { } e)
        {
            return new WorkerRenderPayload(
                Mode: "bbox",
                Bbox: [e.West, e.South, e.East, e.North],
                Center: null,
                ScalePresetId: request.ScalePresetId,
                Tier: request.Tier,
                Overlap: request.Overlap,
                Basemap: true,
                OutputPath: request.OutputFileName);
        }

        if (request.Locations.Count > 0)
        {
            var first = request.Locations[0];
            return new WorkerRenderPayload(
                Mode: "location",
                Bbox: null,
                Center: new WorkerCenter(first.Longitude, first.Latitude),
                ScalePresetId: request.ScalePresetId,
                Tier: request.Tier,
                Overlap: request.Overlap,
                Basemap: true,
                OutputPath: request.OutputFileName);
        }

        throw new InvalidOperationException(
            "Cannot render: the project has neither an extent (bbox) nor any saved locations.");
    }

    public async Task<RenderWorkerResult> RenderAsync(RenderWorkerRequest request, CancellationToken ct = default)
    {
        var payload = ToWirePayload(request);

        using var response = await http.PostAsJsonAsync("/render", payload, s_writeOptions, ct);

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

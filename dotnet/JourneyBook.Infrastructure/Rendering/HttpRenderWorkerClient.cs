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
        bool Notes);

    private sealed record WorkerCenter(double Lng, double Lat);

    /// <summary>A saved location → the worker's <c>RenderLocation</c> ({ center, label, scalePresetId, pin, notes }).</summary>
    private sealed record WorkerLocation(WorkerCenter Center, string? Label, string? ScalePresetId, WorkerPin? Pin, string? Notes);

    /// <summary>A location's custom pin → the worker's <c>{ shape, color }</c>.</summary>
    private sealed record WorkerPin(string? Shape, string? Color);

    /// <summary>A persisted landmark → the worker's landmark furniture ({ lng, lat, name, category, score }).</summary>
    private sealed record WorkerLandmark(double Lng, double Lat, string Name, string Category, double Score);

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
                    l.Notes))
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
                Basemap: true,
                OutputPath: request.OutputFileName,
                TileBaseUrl: request.TileBaseUrl,
                TileSourceId: request.TileSourceId,
                Route: request.Route,
                Landmarks: landmarks,
                TableOfContents: request.TableOfContents,
                Overview: request.Overview,
                ReferenceGrid: request.ReferenceGrid,
                Notes: request.Notes);
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
                Basemap: true,
                OutputPath: request.OutputFileName,
                TileBaseUrl: request.TileBaseUrl,
                TileSourceId: request.TileSourceId,
                Route: request.Route,
                Landmarks: landmarks,
                TableOfContents: request.TableOfContents,
                Overview: request.Overview,
                ReferenceGrid: request.ReferenceGrid,
                Notes: request.Notes);
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

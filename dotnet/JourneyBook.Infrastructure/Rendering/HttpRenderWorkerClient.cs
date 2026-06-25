using System.Net.Http.Json;
using System.Text.Json;
using JourneyBook.Application.Rendering;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// Typed <see cref="HttpClient"/> that POSTs render jobs to the Node render-worker
/// service at the configured base URL. The worker speaks camelCase JSON.
/// </summary>
public class HttpRenderWorkerClient(HttpClient http) : IRenderWorkerClient
{
    private static readonly JsonSerializerOptions s_readOptions =
        new() { PropertyNameCaseInsensitive = true };

    private static readonly JsonSerializerOptions s_writeOptions =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task<RenderWorkerResult> RenderAsync(RenderWorkerRequest request, CancellationToken ct = default)
    {
        var response = await http.PostAsJsonAsync("/render", request, s_writeOptions, ct);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<RenderWorkerResult>(s_readOptions, ct);
        if (result is null)
            throw new InvalidOperationException("Render worker returned an empty or unparseable response.");

        return result;
    }
}

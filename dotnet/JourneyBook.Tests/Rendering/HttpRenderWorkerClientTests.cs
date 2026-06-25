using System.Net;
using System.Text;
using System.Text.Json;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Rendering;

namespace JourneyBook.Tests.Rendering;

/// <summary>
/// Verifies that <see cref="HttpRenderWorkerClient"/> serializes the C# render
/// request into the worker's <c>RenderAtlasInput</c> wire contract
/// (<c>mode</c>/<c>bbox</c>|<c>center</c>/<c>scalePresetId</c>/<c>tier</c>/<c>outputPath</c>),
/// not the internal C# shape. The factory's stub <c>FakeRenderWorkerClient</c> in the
/// API integration tests cannot catch a wire-contract mismatch — this test can.
/// </summary>
public class HttpRenderWorkerClientTests
{
    private sealed class CapturingHandler(string responseJson) : HttpMessageHandler
    {
        public string? CapturedBody { get; private set; }
        public string? CapturedPath { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CapturedPath = request.RequestUri?.AbsolutePath;
            CapturedBody = request.Content is null
                ? null
                : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseJson, Encoding.UTF8, "application/json"),
            };
        }
    }

    private static (HttpRenderWorkerClient client, CapturingHandler handler) Build()
    {
        var handler = new CapturingHandler(
            "{\"outputPath\":\"atlas-x.pdf\",\"pageCount\":1,\"attribution\":\"USGS\"}");
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://render-worker:8090") };
        return (new HttpRenderWorkerClient(http), handler);
    }

    [Fact]
    public async Task Extent_request_serializes_to_bbox_mode_with_array_and_outputPath()
    {
        var (client, handler) = Build();
        var req = new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min",
            Tier: 2,
            Orientation: "Portrait",
            Overlap: 0.05,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [],
            OutputFileName: "atlas-abc.pdf");

        var result = await client.RenderAsync(req);

        Assert.Equal("/render", handler.CapturedPath);
        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        var root = doc.RootElement;

        // Worker contract fields present and correctly shaped.
        Assert.Equal("bbox", root.GetProperty("mode").GetString());
        var bbox = root.GetProperty("bbox").EnumerateArray().Select(e => e.GetDouble()).ToArray();
        Assert.Equal(new[] { -96.75, 40.78, -96.65, 40.85 }, bbox);
        Assert.Equal("usgs-7-5-min", root.GetProperty("scalePresetId").GetString());
        Assert.Equal(2, root.GetProperty("tier").GetInt32());
        Assert.Equal("atlas-abc.pdf", root.GetProperty("outputPath").GetString());

        // Legacy C# shape must NOT be on the wire (would 400 at the worker).
        Assert.False(root.TryGetProperty("extent", out _));
        Assert.False(root.TryGetProperty("locations", out _));
        Assert.False(root.TryGetProperty("outputFileName", out _));
        Assert.False(root.TryGetProperty("margins", out _));
        Assert.False(root.TryGetProperty("orientation", out _));

        Assert.Equal("atlas-x.pdf", result.OutputPath);
        Assert.Equal(1, result.PageCount);
    }

    [Fact]
    public async Task Location_only_request_serializes_to_location_mode_with_center()
    {
        var (client, handler) = Build();
        var req = new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min",
            Tier: 1,
            Orientation: "Portrait",
            Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: null,
            Locations: [new RenderLocationDto(-96.70, 40.81, "Home")],
            OutputFileName: "atlas-loc.pdf");

        await client.RenderAsync(req);

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        var root = doc.RootElement;
        Assert.Equal("location", root.GetProperty("mode").GetString());
        var center = root.GetProperty("center");
        Assert.Equal(-96.70, center.GetProperty("lng").GetDouble());
        Assert.Equal(40.81, center.GetProperty("lat").GetDouble());
        Assert.Equal("atlas-loc.pdf", root.GetProperty("outputPath").GetString());
        Assert.False(root.TryGetProperty("bbox", out _)); // null bbox omitted
    }

    [Fact]
    public async Task No_geometry_throws_rather_than_sending_an_unrenderable_request()
    {
        var (client, _) = Build();
        var req = new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 1, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: null, Locations: [], OutputFileName: "atlas-empty.pdf");

        await Assert.ThrowsAsync<InvalidOperationException>(() => client.RenderAsync(req));
    }
}

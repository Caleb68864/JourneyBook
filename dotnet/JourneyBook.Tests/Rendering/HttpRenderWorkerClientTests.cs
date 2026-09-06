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
    public async Task Route_flag_serializes_to_camelCase_route_true_on_the_wire()
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
            OutputFileName: "atlas-route.pdf",
            Route: true);

        await client.RenderAsync(req);

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        var root = doc.RootElement;

        // Worker's RenderAtlasInput receives camelCase `route: true`.
        Assert.True(root.TryGetProperty("route", out var route));
        Assert.True(route.GetBoolean());
    }

    [Fact]
    public async Task Route_defaults_to_false_on_the_wire_when_unset()
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
        Assert.True(root.TryGetProperty("route", out var route));
        Assert.False(route.GetBoolean());
    }

    [Fact]
    public async Task Location_zoom_ladder_serializes_as_camelCase_zoomLevels_in_order()
    {
        var (client, handler) = Build();
        var req = new RenderWorkerRequest(
            ScalePresetId: "1-100000",
            Tier: 2,
            Orientation: "Portrait",
            Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: null,
            Locations:
            [
                new RenderLocationDto(-96.70, 40.81, "Home"),
                new RenderLocationDto(-95.93, 41.26, "Grandma's", PinShape: "star", PinColor: "#b03a2e",
                    ZoomLevels: ["1-100000", "1-50000", "usgs-7-5-min"]),
            ],
            OutputFileName: "atlas-ladder.pdf");

        await client.RenderAsync(req);

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        var locations = doc.RootElement.GetProperty("locations").EnumerateArray().ToArray();
        Assert.Equal(2, locations.Length);

        // A location with no ladder omits the field entirely (WhenWritingNull), so
        // it serializes exactly as it did before ladders existed.
        Assert.False(locations[0].TryGetProperty("zoomLevels", out _));

        // The ladder keeps its coarse -> fine order; the engine renders L2a/L2b/L2c from it.
        var levels = locations[1].GetProperty("zoomLevels").EnumerateArray().Select(e => e.GetString()).ToArray();
        Assert.Equal(new[] { "1-100000", "1-50000", "usgs-7-5-min" }, levels);
        Assert.Equal("star", locations[1].GetProperty("pin").GetProperty("shape").GetString());
    }

    [Fact]
    public async Task Cover_flag_is_sent_in_location_mode_and_forced_false_when_an_extent_defines_the_grid()
    {
        // No extent: cover is what produces the grid, so it must reach the worker.
        var (locationClient, locationHandler) = Build();
        await locationClient.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "1-100000", Tier: 1, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: null,
            Locations: [new RenderLocationDto(-96.70, 40.81, "Home")],
            OutputFileName: "atlas-cover.pdf",
            Cover: true));

        using (var doc = JsonDocument.Parse(locationHandler.CapturedBody!))
        {
            Assert.True(doc.RootElement.GetProperty("cover").GetBoolean());
        }

        // With an extent the bbox already IS the grid, so cover is sent false even
        // when requested - the engine ignores it there, and a self-consistent
        // payload keeps the wire honest about what will actually be rendered.
        var (bboxClient, bboxHandler) = Build();
        await bboxClient.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "1-100000", Tier: 1, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [new RenderLocationDto(-96.70, 40.81, "Home")],
            OutputFileName: "atlas-cover-bbox.pdf",
            Cover: true));

        using (var doc = JsonDocument.Parse(bboxHandler.CapturedBody!))
        {
            Assert.False(doc.RootElement.GetProperty("cover").GetBoolean());
        }
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

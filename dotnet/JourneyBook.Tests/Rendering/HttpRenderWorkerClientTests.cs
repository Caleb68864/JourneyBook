using System.Diagnostics;
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

        // Page setup MUST be on the wire. These two assertions used to read
        // `Assert.False(...TryGetProperty("margins"))` — they pinned the drop in
        // place: the engine has no way to know the sheet setup it is laying out for,
        // so it fell back to LETTER_PORTRAIT and every project printed at 0.5in
        // portrait however its page setup was saved.
        Assert.True(root.TryGetProperty("margins", out var margins));
        Assert.Equal(0.5, margins.GetProperty("left").GetDouble());
        Assert.Equal("portrait", root.GetProperty("orientation").GetString());

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

    /// <summary>
    /// Non-default page setup reaches the engine intact.
    /// </summary>
    /// <remarks>
    /// Margins, gutter and orientation survive EF, validation, the duplicate endpoint
    /// and the web adapter — each with its own tests using non-default values — and
    /// then stopped here, because the wire payload had no member for them. Since the
    /// print fix, the printed map box is the printable area less the page furniture,
    /// so a margin change MOVES THE PRINTED FOOTPRINT: the one setting that changes
    /// scale and page count was the one setting that could not reach the renderer.
    ///
    /// Every other test in this file passes the 0.5in portrait defaults, so the drop
    /// was literally unobservable — the values the engine fell back to were the values
    /// it was being sent.
    /// </remarks>
    [Fact]
    public async Task Non_default_margins_gutter_and_orientation_reach_the_worker()
    {
        var (client, handler) = Build();
        var req = new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min",
            Tier: 2,
            Orientation: "Landscape",
            Overlap: 0,
            // Four DIFFERENT sides plus a gutter: a payload that copied one value to
            // all four, or dropped the gutter, cannot pass this.
            Margins: new RenderMarginsDto(Top: 0.75, Right: 0.6, Bottom: 0.8, Left: 0.9, Gutter: 0.25),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [],
            OutputFileName: "atlas-margins.pdf");

        await client.RenderAsync(req);

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        var margins = doc.RootElement.GetProperty("margins");
        Assert.Equal(0.75, margins.GetProperty("top").GetDouble());
        Assert.Equal(0.6, margins.GetProperty("right").GetDouble());
        Assert.Equal(0.8, margins.GetProperty("bottom").GetDouble());
        Assert.Equal(0.9, margins.GetProperty("left").GetDouble());
        Assert.Equal(0.25, margins.GetProperty("gutter").GetDouble());
    }

    /// <summary>
    /// Orientation is lower-cased on the wire.
    /// </summary>
    /// <remarks>
    /// The latent half of the same bug. C# renders the <c>PageOrientation</c> enum as
    /// "Portrait"/"Landscape"; the engine's union is "portrait"|"landscape" and the
    /// renderer's own test is <c>page.orientation === "landscape"</c>. Forwarding
    /// <c>ToString()</c> would have made every landscape project print portrait —
    /// silently, since neither side would have complained.
    /// </remarks>
    [Theory]
    [InlineData("Landscape", "landscape")]
    [InlineData("landscape", "landscape")]
    [InlineData("Portrait", "portrait")]
    [InlineData("portrait", "portrait")]
    public async Task Orientation_is_lower_cased_for_the_engines_union_type(string csharp, string wire)
    {
        var (client, handler) = Build();
        await client.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 1, Orientation: csharp, Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: "atlas-orientation.pdf"));

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        Assert.Equal(wire, doc.RootElement.GetProperty("orientation").GetString());
    }

    [Fact]
    public async Task Location_mode_carries_the_page_setup_too()
    {
        var (client, handler) = Build();
        await client.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 1, Orientation: "Landscape", Overlap: 0,
            Margins: new RenderMarginsDto(0.375, 0.375, 0.375, 0.375, Gutter: 0.5),
            Extent: null,
            Locations: [new RenderLocationDto(-96.7, 40.8, "Home")],
            OutputFileName: "atlas-loc.pdf"));

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        var root = doc.RootElement;
        Assert.Equal("location", root.GetProperty("mode").GetString());
        // The bbox branch and the location branch build the payload separately, so a
        // fix applied to one only is a fix applied to half the product.
        Assert.Equal("landscape", root.GetProperty("orientation").GetString());
        Assert.Equal(0.5, root.GetProperty("margins").GetProperty("gutter").GetDouble());
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

    // ── The client's own timeout ─────────────────────────────────────────────

    /// <summary>Never answers, so the only thing that can end the call is the timeout.</summary>
    private sealed class NeverAnsweringHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            throw new UnreachableException();
        }
    }

    [Fact]
    public async Task A_worker_that_never_answers_reports_a_timeout_not_a_cancellation()
    {
        using var http = new HttpClient(new NeverAnsweringHandler())
        {
            BaseAddress = new Uri("http://render-worker:8090"),
            Timeout = TimeSpan.FromMilliseconds(250),
        };
        var client = new HttpRenderWorkerClient(http);

        var req = new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 1, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: "atlas-slow.pdf");

        // HttpClient signals its OWN timeout as TaskCanceledException — an
        // OperationCanceledException. Left as-is it travels all the way to
        // RenderJobRunner's catch, which reports every OperationCanceledException as
        // "the service shut down or the job was aborted". Nothing shut down and
        // nobody aborted: the API gave up on the worker. Name it here, where the
        // deadline actually lives and the number is known.
        var ex = await Assert.ThrowsAsync<TimeoutException>(() => client.RenderAsync(req));

        Assert.Contains("timed out", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("RenderWorker:TimeoutSeconds", ex.Message, StringComparison.Ordinal);
        Assert.Contains("0.25", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_caller_cancelling_is_still_a_cancellation_not_a_timeout()
    {
        using var http = new HttpClient(new NeverAnsweringHandler())
        {
            BaseAddress = new Uri("http://render-worker:8090"),
            Timeout = TimeSpan.FromMinutes(15),
        };
        var client = new HttpRenderWorkerClient(http);
        using var cts = new CancellationTokenSource();

        var req = new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 1, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: "atlas-cancelled.pdf");

        var call = client.RenderAsync(req, cts.Token);
        await cts.CancelAsync();

        // Host shutdown must keep its own diagnosis: only a deadline the caller did
        // not ask for is a timeout.
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
    }
}

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
    /// <summary>
    /// A fake render worker speaking the ADR 0007 job protocol: <c>POST /render</c>
    /// answers 202 with a job id, <c>GET /jobs/{id}</c> walks a scripted sequence of
    /// records, <c>DELETE /jobs/{id}</c> is noted.
    /// </summary>
    /// <remarks>
    /// The POST body is still what most of these tests are about — the wire contract
    /// — so <see cref="CapturedBody"/> and <see cref="CapturedPath"/> record the
    /// POST and nothing else. A handler that let the polls overwrite them would
    /// leave every wire assertion in this file reading a <c>GET /jobs/…</c>, which is
    /// a suite that passes while measuring the wrong request.
    /// </remarks>
    private sealed class FakeWorkerHandler : HttpMessageHandler
    {
        private int _polls;

        public FakeWorkerHandler(params string[] jobRecords)
        {
            JobRecords = jobRecords.Length > 0
                ? jobRecords
                : ["{\"id\":\"job-1\",\"state\":\"completed\",\"page\":1,\"pageCount\":1,\"phase\":\"done\",\"outputPath\":\"atlas-x.pdf\",\"attribution\":\"USGS\"}"];
        }

        /// <summary>The POST /render body, and only that.</summary>
        public string? CapturedBody { get; private set; }
        public string? CapturedPath { get; private set; }

        /// <summary>Scripted <c>GET /jobs/{id}</c> answers; the last one repeats.</summary>
        public IReadOnlyList<string> JobRecords { get; }

        /// <summary>Status the POST answers with. 202 is the protocol; others test refusal.</summary>
        public HttpStatusCode AcceptStatus { get; set; } = HttpStatusCode.Accepted;

        /// <summary>Body the POST answers with when <see cref="AcceptStatus"/> is not 202.</summary>
        public string AcceptErrorBody { get; set; } = "{\"error\":\"refused\"}";

        /// <summary>Status every <c>GET /jobs/{id}</c> answers with.</summary>
        public HttpStatusCode PollStatus { get; set; } = HttpStatusCode.OK;

        /// <summary>True once the client has told the worker to stop.</summary>
        public bool CancelledOnWorker { get; private set; }

        public int Polls => _polls;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? "";

            if (request.Method == HttpMethod.Delete)
            {
                CancelledOnWorker = true;
                return Json(HttpStatusCode.OK, "{\"id\":\"job-1\",\"state\":\"cancelled\",\"page\":0,\"pageCount\":0}");
            }

            if (request.Method == HttpMethod.Post)
            {
                CapturedPath = path;
                CapturedBody = request.Content is null
                    ? null
                    : await request.Content.ReadAsStringAsync(cancellationToken);
                return AcceptStatus == HttpStatusCode.Accepted
                    ? Json(HttpStatusCode.Accepted,
                        "{\"jobId\":\"job-1\",\"state\":\"rendering\",\"statusUrl\":\"/jobs/job-1\"}")
                    : Json(AcceptStatus, AcceptErrorBody);
            }

            var index = Math.Min(_polls, JobRecords.Count - 1);
            _polls++;
            return PollStatus == HttpStatusCode.OK
                ? Json(HttpStatusCode.OK, JobRecords[index])
                : Json(PollStatus, "{\"error\":\"no such job\"}");
        }

        private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
            new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    /// <summary>A client whose poll interval is a millisecond, so the loop is testable.</summary>
    private static HttpRenderWorkerClient ClientFor(FakeWorkerHandler handler, TimeSpan? timeout = null) =>
        new(
            new HttpClient(handler)
            {
                BaseAddress = new Uri("http://render-worker:8090"),
                Timeout = timeout ?? TimeSpan.FromMinutes(15),
            },
            new RenderWorkerPollOptions(TimeSpan.FromMilliseconds(1)));

    private static (HttpRenderWorkerClient client, FakeWorkerHandler handler) Build()
    {
        var handler = new FakeWorkerHandler();
        return (ClientFor(handler), handler);
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

        // So must overlap. These tests SUPPLIED 0.05 and never looked at it, so
        // hardcoding `Overlap: 0` on the wire left 95 of 95 .NET tests green —
        // the margins bug's exact shape on the very next field of the same
        // payload, with one difference: the margins tests at least asserted
        // absence (visibly wrong), while overlap was simply never read.
        Assert.Equal(0.05, root.GetProperty("overlap").GetDouble());

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

    /// <summary>
    /// Overlap is the width of the strip of ground two adjacent pages both carry —
    /// the thing that stops a feature falling into a seam and a pinhole opening
    /// where four pages meet. It reaches the engine only through this field, in
    /// both payload branches, and nothing used to read it back.
    /// </summary>
    [Theory]
    [InlineData(0.0)]
    [InlineData(0.05)]
    [InlineData(0.25)]
    public async Task Overlap_reaches_the_worker_unchanged_in_both_payload_branches(double overlap)
    {
        var (bboxClient, bboxHandler) = Build();
        await bboxClient.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 2, Orientation: "Portrait", Overlap: overlap,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: "atlas-overlap-bbox.pdf"));

        using (var doc = JsonDocument.Parse(bboxHandler.CapturedBody!))
        {
            Assert.Equal(overlap, doc.RootElement.GetProperty("overlap").GetDouble());
        }

        // The location branch builds its payload separately — a fix applied to one
        // branch only is a fix applied to half the product (see the margins/gutter
        // test above, which exists for the same reason).
        var (locationClient, locationHandler) = Build();
        await locationClient.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "usgs-7-5-min", Tier: 2, Orientation: "Portrait", Overlap: overlap,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: null,
            Locations: [new RenderLocationDto(-96.70, 40.81, "Home")],
            OutputFileName: "atlas-overlap-loc.pdf",
            Cover: true));

        using (var doc = JsonDocument.Parse(locationHandler.CapturedBody!))
        {
            Assert.Equal(overlap, doc.RootElement.GetProperty("overlap").GetDouble());
        }
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

    // ── The job protocol (ADR 0007) ──────────────────────────────────────────

    private static RenderWorkerRequest JobRequest(string name = "atlas-job.pdf") => new(
        ScalePresetId: "usgs-7-5-min", Tier: 1, Orientation: "Portrait", Overlap: 0,
        Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
        Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
        Locations: [], OutputFileName: name);

    [Fact]
    public async Task Follows_an_accepted_job_to_completion_and_returns_its_result()
    {
        var handler = new FakeWorkerHandler(
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":0,\"pageCount\":3,\"phase\":\"contract\"}",
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":2,\"pageCount\":3,\"phase\":\"panel\"}",
            "{\"id\":\"job-1\",\"state\":\"completed\",\"page\":3,\"pageCount\":3,\"phase\":\"done\",\"outputPath\":\"atlas-job.pdf\",\"attribution\":\"USGS\"}");

        var result = await ClientFor(handler).RenderAsync(JobRequest());

        Assert.Equal("atlas-job.pdf", result.OutputPath);
        Assert.Equal(3, result.PageCount);
        Assert.Equal("USGS", result.Attribution);
        // More than one poll: a client that read the record once and returned would
        // have answered "rendering" as if it were a result.
        Assert.True(handler.Polls >= 3, $"only polled {handler.Polls} times");
    }

    [Fact]
    public async Task Reports_each_distinct_position_to_the_caller_exactly_once()
    {
        var handler = new FakeWorkerHandler(
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":0,\"pageCount\":3,\"phase\":\"contract\"}",
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":1,\"pageCount\":3,\"phase\":\"panel\"}",
            // Deliberately repeated: the worker is polled faster than it renders, so
            // most polls return the SAME position. Reporting each one would be a
            // database write per poll rather than per page.
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":1,\"pageCount\":3,\"phase\":\"panel\"}",
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":2,\"pageCount\":3,\"phase\":\"panel\"}",
            "{\"id\":\"job-1\",\"state\":\"completed\",\"page\":3,\"pageCount\":3,\"phase\":\"done\",\"outputPath\":\"atlas-job.pdf\"}");

        var seen = new List<RenderProgressUpdate>();
        await ClientFor(handler).RenderAsync(
            JobRequest(),
            (u, _) => { seen.Add(u); return Task.CompletedTask; });

        Assert.Equal([0, 1, 2], seen.Select(u => u.Page));
        Assert.All(seen, u => Assert.Equal(3, u.PageCount));
        // The engine's own phase names, carried through rather than re-invented.
        Assert.Equal(["contract", "panel", "panel"], seen.Select(u => u.Phase));
    }

    [Fact]
    public async Task A_failed_job_throws_with_the_workers_own_diagnostic_and_its_kind()
    {
        var handler = new FakeWorkerHandler(
            "{\"id\":\"job-1\",\"state\":\"failed\",\"page\":2,\"pageCount\":9,\"errorKind\":\"upstream\",\"error\":\"Failed to fetch basemap tile panel for page A3\"}");

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => ClientFor(handler).RenderAsync(JobRequest()));

        Assert.Contains("Failed to fetch basemap tile panel", ex.Message, StringComparison.Ordinal);
        // The kind is a field the worker recorded at the throw site, not a substring
        // guessed here — that guessing is what once turned a timeout into a cancel.
        Assert.Contains("upstream", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_cancelled_job_throws_a_cancellation_not_a_failure()
    {
        var handler = new FakeWorkerHandler(
            "{\"id\":\"job-1\",\"state\":\"cancelled\",\"page\":4,\"pageCount\":12,\"errorKind\":\"cancelled\",\"error\":\"Render was cancelled after 4 of 12 pages.\"}");

        var ex = await Assert.ThrowsAsync<RenderCancelledException>(
            () => ClientFor(handler).RenderAsync(JobRequest()));

        Assert.Contains("4 of 12", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_cancel_reaches_the_worker_rather_than_only_the_API()
    {
        // THE point of the whole protocol. Abandoning the API's own wait would leave
        // the worker rendering to completion, still fetching every tile, for an atlas
        // nobody can reach — a cancel button that cancels a progress bar.
        var handler = new FakeWorkerHandler(
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":1,\"pageCount\":50,\"phase\":\"panel\"}");
        using var cts = new CancellationTokenSource();

        var call = ClientFor(handler).RenderAsync(
            JobRequest(),
            (_, _) => { cts.Cancel(); return Task.CompletedTask; },
            cts.Token);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
        Assert.True(handler.CancelledOnWorker, "the worker was never told to stop");
    }

    [Fact]
    public async Task Control_a_completed_render_is_not_cancelled_on_the_worker()
    {
        // The acceptance control for the test above: a DELETE on the happy path
        // would be a client that cancels every render it has just finished.
        var (client, handler) = Build();
        await client.RenderAsync(JobRequest());
        Assert.False(handler.CancelledOnWorker);
    }

    [Fact]
    public async Task Gives_up_at_its_deadline_and_stops_the_worker_rather_than_abandoning_it()
    {
        var handler = new FakeWorkerHandler(
            "{\"id\":\"job-1\",\"state\":\"rendering\",\"page\":1,\"pageCount\":200,\"phase\":\"panel\"}");

        var ex = await Assert.ThrowsAsync<TimeoutException>(
            () => ClientFor(handler, TimeSpan.FromMilliseconds(1)).RenderAsync(JobRequest()));

        // Says where the render had got to, which is the difference between "it is
        // too slow" and "it is stuck".
        Assert.Contains("page 1 of 200", ex.Message, StringComparison.Ordinal);
        Assert.Contains("RenderWorker:TimeoutSeconds", ex.Message, StringComparison.Ordinal);
        Assert.True(handler.CancelledOnWorker, "the API gave up and left the worker rendering");
    }

    [Fact]
    public async Task A_job_the_worker_has_forgotten_is_reported_as_gone_not_waited_on()
    {
        var handler = new FakeWorkerHandler { PollStatus = HttpStatusCode.NotFound };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => ClientFor(handler).RenderAsync(JobRequest()));

        // A worker restart loses its jobs (they are in memory, ADR 0007). Polling a
        // job that no longer exists until the deadline would report the wrong reason
        // fifteen minutes late.
        Assert.Contains("restarted", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_refused_request_still_carries_the_workers_400_verbatim()
    {
        // Everything judgeable before a job exists still answers on the POST, and its
        // wording is the only thing the user will see on the failed record.
        var handler = new FakeWorkerHandler
        {
            AcceptStatus = HttpStatusCode.BadRequest,
            AcceptErrorBody = "{\"error\":\"Invalid request: this extent produces 5256 pages\"}",
        };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => ClientFor(handler).RenderAsync(JobRequest()));

        Assert.Contains("5256 pages", ex.Message, StringComparison.Ordinal);
        Assert.Contains("400", ex.Message, StringComparison.Ordinal);
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

        var call = client.RenderAsync(req, null, cts.Token);
        await cts.CancelAsync();

        // Host shutdown must keep its own diagnosis: only a deadline the caller did
        // not ask for is a timeout.
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
    }

    // ── Basemap panel knobs (F08) ────────────────────────────────────────────

    /// <summary>
    /// The basemap knobs the CLI has always had reach the worker from the API.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>Basemap</c> was not absent here, it was <b>hardcoded <c>true</c></b> in
    /// both payload branches, and <c>panelWidthPx</c>/<c>panelFormat</c>/
    /// <c>panelQuality</c> had no member on the wire record at all. So every API
    /// render did a full tile fetch at the engine's own defaults, and the web app
    /// could reach strictly less than <c>render-cli</c>, which has exposed
    /// <c>--basemap</c>, <c>--panel-px</c>, <c>--panel-format</c> and
    /// <c>--panel-quality</c> since Stage 1E.
    /// </para>
    /// <para>
    /// The values chosen here are all NON-default — basemap off, a width that is
    /// neither 1000 nor 1730, png rather than jpeg, quality 55 rather than 90 —
    /// because the whole shape of this class of bug is a test that supplies a
    /// value the receiver was going to assume anyway. See the margins and overlap
    /// tests above, which exist for exactly that reason.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task Basemap_off_and_panel_knobs_reach_the_worker_in_both_payload_branches()
    {
        var (bboxClient, bboxHandler) = Build();
        await bboxClient.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "1-50000", Tier: 2, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: "atlas-knobs-bbox.pdf",
            Basemap: false, PanelWidthPx: 2048, PanelFormat: "png", PanelQuality: 55));

        using (var doc = JsonDocument.Parse(bboxHandler.CapturedBody!))
        {
            var root = doc.RootElement;
            Assert.False(root.GetProperty("basemap").GetBoolean());
            Assert.Equal(2048, root.GetProperty("panelWidthPx").GetInt32());
            Assert.Equal("png", root.GetProperty("panelFormat").GetString());
            Assert.Equal(55, root.GetProperty("panelQuality").GetInt32());
        }

        // The location branch builds its payload separately — a fix applied to one
        // branch only is a fix applied to half the product.
        var (locClient, locHandler) = Build();
        await locClient.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "1-50000", Tier: 2, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: null,
            Locations: [new RenderLocationDto(-96.70, 40.81, "Home")],
            OutputFileName: "atlas-knobs-loc.pdf",
            Basemap: false, PanelWidthPx: 2048, PanelFormat: "png", PanelQuality: 55));

        using (var doc = JsonDocument.Parse(locHandler.CapturedBody!))
        {
            var root = doc.RootElement;
            Assert.False(root.GetProperty("basemap").GetBoolean());
            Assert.Equal(2048, root.GetProperty("panelWidthPx").GetInt32());
            Assert.Equal("png", root.GetProperty("panelFormat").GetString());
            Assert.Equal(55, root.GetProperty("panelQuality").GetInt32());
        }
    }

    /// <summary>
    /// The must-be-ACCEPTED control for the change above: a request that sets no
    /// knob must serialize exactly as it did before they existed.
    /// </summary>
    /// <remarks>
    /// An unset panel knob has to be an ABSENT wire field, not a C# default. The
    /// engine picks each page's width from its own scale preset
    /// (<c>ScalePreset.panelWidthPx</c>, 1730 px for the four presets short of
    /// 300 DPI), so a payload that always sent, say, <c>panelWidthPx: 1000</c>
    /// because <c>int</c> cannot be null would silently flatten that per-preset
    /// decision back to one global number — a regression invisible to every
    /// assertion that only checks the knob "arrived".
    /// </remarks>
    [Fact]
    public async Task Unset_panel_knobs_are_absent_from_the_wire_and_basemap_still_defaults_on()
    {
        var (client, handler) = Build();
        await client.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "1-50000", Tier: 2, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: "atlas-default-knobs.pdf"));

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        var root = doc.RootElement;

        Assert.True(root.GetProperty("basemap").GetBoolean());
        Assert.False(root.TryGetProperty("panelWidthPx", out _));
        Assert.False(root.TryGetProperty("panelFormat", out _));
        Assert.False(root.TryGetProperty("panelQuality", out _));
    }

    /// <summary>
    /// The format is lower-cased for the engine's <c>"jpeg" | "png"</c> union.
    /// </summary>
    /// <remarks>
    /// The latent half of the orientation bug, on the very next field: the
    /// worker's JSON schema is <c>enum: ["jpeg", "png"]</c> and
    /// <c>validateInput</c> compares exactly, so forwarding "PNG" from a JSON body
    /// or a query string would be a 400 from the worker for a value the API
    /// accepted.
    /// </remarks>
    [Theory]
    [InlineData("PNG", "png")]
    [InlineData("png", "png")]
    [InlineData("JPEG", "jpeg")]
    [InlineData(" jpeg ", "jpeg")]
    public async Task Panel_format_is_lower_cased_for_the_engines_union_type(string input, string wire)
    {
        var (client, handler) = Build();
        await client.RenderAsync(new RenderWorkerRequest(
            ScalePresetId: "1-50000", Tier: 1, Orientation: "Portrait", Overlap: 0,
            Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5),
            Extent: new RenderBBoxDto(-96.75, 40.78, -96.65, 40.85),
            Locations: [], OutputFileName: "atlas-fmt.pdf",
            PanelFormat: input));

        using var doc = JsonDocument.Parse(handler.CapturedBody!);
        Assert.Equal(wire, doc.RootElement.GetProperty("panelFormat").GetString());
    }
}

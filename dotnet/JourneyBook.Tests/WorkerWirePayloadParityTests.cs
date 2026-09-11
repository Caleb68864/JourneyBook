using System.Text.Json;
using System.Text.RegularExpressions;
using JourneyBook.Application.Common;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Rendering;

namespace JourneyBook.Tests;

/// <summary>
/// The render request exists three times, in two languages, hand-mapped, with no
/// shared schema and no codegen anywhere:
///
///   1. <c>RenderAtlasInput</c> — the engine's interface (TypeScript).
///   2. <c>renderBodySchema</c> in <c>services/render-worker/src/render-route.ts</c>
///      — what the worker will accept.
///   3. <c>WorkerRenderPayload</c> in <c>HttpRenderWorkerClient</c> — what this API
///      actually sends.
///
/// <c>services/render-worker/src/wire-contract.test.ts</c> pins 1 against 2 from the
/// TypeScript side. This pins <b>3 against 2</b>, which is the pair that has actually
/// broken: the API sent <c>Orientation</c> and <c>Margins</c> that the schema had no
/// place for, and later carried <c>panelWidthPx</c>/<c>panelFormat</c>/
/// <c>panelQuality</c> that the schema had to be taught. Each was found by a human
/// reading two files side by side.
/// </summary>
/// <remarks>
/// <para>
/// The payload is serialized rather than reflected over, on purpose. The thing that
/// has to match the schema is the JSON, and between the record and the JSON sit a
/// camel-case naming policy and <c>WhenWritingNull</c> — two places where a member
/// name and a wire name can part company. Reflecting over the record would test the
/// C# names, which is not what the worker reads.
/// </para>
/// <para>
/// Following the lesson recorded with <c>ScalePresetParityTests</c>: do not compare
/// against a frozen artefact. This reads the schema out of the worker's live source,
/// so a field added properly on either side is accepted, and only a field added to
/// one side alone fails.
/// </para>
/// </remarks>
public class WorkerWirePayloadParityTests
{
    /// <summary>Resolve a repo-relative path by walking up from the test binary.</summary>
    private static string RepoFile(string relative)
    {
        var suffix = relative.Replace('/', Path.DirectorySeparatorChar);
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, suffix);
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            $"Could not find {relative} walking up from {AppContext.BaseDirectory}.");
    }

    /// <summary>
    /// The top-level property names of the worker's <c>renderBodySchema</c>, read
    /// out of its real source.
    /// </summary>
    /// <remarks>
    /// A brace-balanced walk from <c>properties: {</c> rather than a line regex,
    /// because the schema nests object literals several deep (<c>locations.items.properties</c>
    /// and friends) and a naive scan would report their members as top-level fields —
    /// a parser that finds MORE than it should is as useless as one that finds none.
    /// </remarks>
    private static IReadOnlySet<string> ParseWorkerSchemaFields()
    {
        var path = RepoFile("services/render-worker/src/render-route.ts");
        var source = File.ReadAllText(path);

        var anchor = source.IndexOf("const renderBodySchema = {", StringComparison.Ordinal);
        if (anchor < 0)
        {
            throw new InvalidOperationException(
                $"Could not find `const renderBodySchema = {{` in {path}. If it moved or changed shape, " +
                "fix this parser — do not let the parity check quietly pass on nothing.");
        }

        var propsAt = source.IndexOf("properties: {", anchor, StringComparison.Ordinal);
        if (propsAt < 0)
        {
            throw new InvalidOperationException(
                $"Found renderBodySchema in {path} but no `properties: {{` block inside it.");
        }

        var open = source.IndexOf('{', propsAt);
        var depth = 0;
        var end = -1;
        for (var i = open; i < source.Length; i++)
        {
            if (source[i] == '{') depth++;
            else if (source[i] == '}')
            {
                depth--;
                if (depth == 0) { end = i; break; }
            }
        }
        if (end < 0)
        {
            throw new InvalidOperationException($"renderBodySchema's properties block in {path} is not brace-balanced.");
        }

        // Walk the block again, recording only identifiers that sit at depth 1.
        var names = new HashSet<string>(StringComparer.Ordinal);
        depth = 0;
        var lineStart = true;
        for (var i = open; i < end; i++)
        {
            var ch = source[i];
            if (ch == '{') { depth++; lineStart = true; continue; }
            if (ch == '}') { depth--; lineStart = true; continue; }
            if (ch is '\n' or ',') { lineStart = true; continue; }
            if (char.IsWhiteSpace(ch)) continue;
            if (!lineStart) continue;
            lineStart = false;

            if (depth != 1) continue;
            var match = Regex.Match(source[i..Math.Min(source.Length, i + 80)], @"^(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*:");
            if (match.Success) names.Add(match.Groups["name"].Value);
        }

        if (names.Count == 0)
        {
            throw new InvalidOperationException(
                $"Found renderBodySchema's properties in {path} but parsed no field names out of it.");
        }
        return names;
    }

    /// <summary>
    /// Every JSON field name this API can put on the wire, taken from a real
    /// serialization of a MAXIMAL request — every optional set, so
    /// <c>WhenWritingNull</c> omits nothing.
    /// </summary>
    private static async Task<IReadOnlySet<string>> SerializedPayloadFieldsAsync()
    {
        var captured = new List<string>();
        var handler = new CapturePostHandler(captured);
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://render-worker:8090") };
        var client = new HttpRenderWorkerClient(http, new RenderWorkerPollOptions(TimeSpan.FromMilliseconds(1)));

        // Deliberately maximal AND location-mode, because the two payload branches
        // differ (`bbox` vs `center`). Both are covered below.
        var withExtent = Maximal() with { Extent = new BBoxDto(-96.75, 40.78, -96.65, 40.85) };
        var locationOnly = Maximal() with { Extent = null };

        await client.RenderAsync(withExtent);
        await client.RenderAsync(locationOnly);

        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var body in captured)
        {
            using var doc = JsonDocument.Parse(body);
            foreach (var prop in doc.RootElement.EnumerateObject()) names.Add(prop.Name);
        }

        if (names.Count == 0)
            throw new InvalidOperationException("No payload was captured, so nothing was compared.");

        return names;
    }

    private static RenderWorkerRequest Maximal() => new(
        ScalePresetId: "usgs-7-5-min",
        Tier: 2,
        Orientation: "Landscape",
        Overlap: 0.05,
        Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5, 0.25),
        Extent: new BBoxDto(-96.75, 40.78, -96.65, 40.85),
        Locations: [new RenderLocationDto(-96.7, 40.8, "Stop", "1-25000", "circle", "#ff0000", "note", ["1-50000"])],
        OutputFileName: "atlas-parity.pdf",
        TileBaseUrl: "http://api:8080/api/tiles",
        TileSourceId: "usgs-topo",
        TileMaxZoom: 16,
        Title: "Pawnee Creek",
        Route: true,
        Landmarks: [new RenderLandmarkDto(-96.7, 40.8, "Water tower", "Landmark", 3)],
        IncludeLandmarks: true,
        TableOfContents: true,
        Overview: true,
        ReferenceGrid: true,
        Notes: true,
        Cover: true,
        Basemap: true,
        PanelWidthPx: 1730,
        PanelFormat: "jpeg",
        PanelQuality: 90);

    /// <summary>Captures POST bodies and answers the job protocol so the call completes.</summary>
    private sealed class CapturePostHandler(List<string> bodies) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method == HttpMethod.Post && request.Content is not null)
            {
                bodies.Add(await request.Content.ReadAsStringAsync(cancellationToken));
                return new HttpResponseMessage(System.Net.HttpStatusCode.Accepted)
                {
                    Content = new StringContent(
                        """{"jobId":"job-1","state":"rendering","statusUrl":"/jobs/job-1"}""",
                        System.Text.Encoding.UTF8, "application/json"),
                };
            }

            return new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"id":"job-1","state":"completed","page":1,"pageCount":1,"outputPath":"atlas-parity.pdf"}""",
                    System.Text.Encoding.UTF8, "application/json"),
            };
        }
    }

    [Fact]
    public async Task Both_sides_were_actually_read()
    {
        // The control for every comparison below. Two empty sets are equal.
        var schema = ParseWorkerSchemaFields();
        var payload = await SerializedPayloadFieldsAsync();
        Assert.True(schema.Count >= 20, $"parsed only {schema.Count} fields out of renderBodySchema");
        Assert.True(payload.Count >= 20, $"the serialized payload carried only {payload.Count} fields");

        // And the parser must be reading the TOP level, not the nested location and
        // landmark shapes. `lng` is a member of both of those and of neither the
        // top-level schema nor the payload; if it appears, the brace walk is broken
        // and every comparison below is comparing the wrong set.
        Assert.DoesNotContain("lng", schema);
        Assert.DoesNotContain("shape", schema);
    }

    [Fact]
    public async Task Every_field_this_API_sends_is_one_the_worker_accepts()
    {
        var schema = ParseWorkerSchemaFields();
        var payload = await SerializedPayloadFieldsAsync();

        var refused = payload.Where(f => !schema.Contains(f)).OrderBy(f => f, StringComparer.Ordinal).ToList();

        Assert.True(
            refused.Count == 0,
            $"The API puts {string.Join(", ", refused)} on the wire and renderBodySchema does not list " +
            "them. The worker refuses an unknown field by name with 400, so every render would fail " +
            "with a message about a field the sender believes is correct.");
    }

    /// <summary>
    /// Fields <c>renderBodySchema</c> accepts that this API deliberately does not
    /// send, each with the reason it is exempt.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This dictionary is the whole point of the test below. The check used to be a
    /// hand-written list of five field names that must be present — which meant a
    /// field the API <b>ought</b> to send but does not was invisible, because nothing
    /// ever compared the two sets in that direction. Two of the four names this
    /// comment block originally called "legitimately absent" were not legitimate at
    /// all:
    /// </para>
    /// <list type="bullet">
    /// <item><c>title</c> — the project has a name, the user typed it, and every
    /// atlas the API rendered printed the literal string "Journey Book" on every
    /// page header, the overview, the contents page and the PDF's own metadata.</item>
    /// <item><c>tileMaxZoom</c> — its docstring in <c>render.ts</c> says it is
    /// "needed when tiles come through the proxy from a registered <c>TileSource</c>
    /// whose <c>MaxZoom</c> this process cannot see", which is precisely and only
    /// what this API does. It was the one caller the field exists for.</item>
    /// </list>
    /// <para>
    /// Both are now sent. An exemption's stated reason is a claim like any other, so
    /// the test also refuses a STALE entry — one naming a field the schema no longer
    /// has, or one the API has since started sending — because an allowlist nobody
    /// re-reads is how the first two survived.
    /// </para>
    /// </remarks>
    private static readonly IReadOnlyDictionary<string, string> NotSentOnPurpose =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["zoomLevels"] =
                "Atlas-level default ladder (render.ts:135: 'applied to every location that has no " +
                "zoomLevels of its own'). The API has no atlas-wide ladder; it carries the ladder " +
                "PER LOCATION and always sends each location's own, so the default would never apply.",
            ["coverPadFraction"] =
                "Padding around the cover extent. No project column, no member on RenderProjectRequest, " +
                "and no CLI-reachable value the API has ever held — the engine's own default is the " +
                "only value that has ever been used. A wire field for a number nobody can set would be " +
                "the half-wired control this test exists to find.",
        };

    [Fact]
    public async Task Every_field_the_worker_accepts_is_either_sent_or_exempt_with_a_reason()
    {
        var schema = ParseWorkerSchemaFields();
        var payload = await SerializedPayloadFieldsAsync();

        // The direction that had no check at all. `outputPath`/`mode`/`bbox`/`center`
        // are excluded because the payload branches on them: a maximal serialization
        // covers both branches (see SerializedPayloadFieldsAsync), so they are all
        // present and need no exemption.
        var absent = schema
            .Where(f => !payload.Contains(f))
            .Where(f => !NotSentOnPurpose.ContainsKey(f))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        Assert.True(
            absent.Count == 0,
            $"renderBodySchema accepts {string.Join(", ", absent)} and this API never puts " +
            "it on the wire. Either send it, or add it to NotSentOnPurpose with the reason — " +
            "there is no third state. `title` sat in this gap and every API-rendered atlas was " +
            "titled \"Journey Book\" while the project's own name was in the database.");
    }

    [Fact]
    public async Task No_exemption_has_gone_stale()
    {
        var schema = ParseWorkerSchemaFields();
        var payload = await SerializedPayloadFieldsAsync();

        var gone = NotSentOnPurpose.Keys
            .Where(f => !schema.Contains(f))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();
        Assert.True(
            gone.Count == 0,
            $"NotSentOnPurpose exempts {string.Join(", ", gone)}, which renderBodySchema no longer " +
            "accepts. The exemption is about a field that does not exist; delete the entry.");

        var nowSent = NotSentOnPurpose.Keys
            .Where(payload.Contains)
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();
        Assert.True(
            nowSent.Count == 0,
            $"NotSentOnPurpose claims the API does not send {string.Join(", ", nowSent)}, and it does. " +
            "The reason recorded there is now false; delete the entry.");

        // And the exemption list must stay small enough to read. Not a style rule:
        // the failure this replaces was a five-name list nobody re-derived, and an
        // allowlist that grows without anyone noticing is the same object.
        Assert.True(
            NotSentOnPurpose.Count <= 6,
            $"{NotSentOnPurpose.Count} exempted wire fields. Every one is a capability the engine " +
            "has and the API cannot reach; past a handful that is a finding, not an allowlist.");
    }

    [Fact]
    public async Task Every_field_this_API_means_to_send_is_one_the_worker_accepts()
    {
        var schema = ParseWorkerSchemaFields();
        var payload = await SerializedPayloadFieldsAsync();

        // Kept alongside the set comparison above, pinned per name, for the fields
        // that have actually been dropped here before. The set check would catch a
        // field vanishing from the SCHEMA; these also name why each one matters, so
        // a failure reads as a regression report rather than a diff.
        foreach (var required in new[]
                 { "orientation", "margins", "overlap", "basemap", "panelWidthPx", "title", "tileMaxZoom" })
        {
            Assert.True(
                schema.Contains(required),
                $"renderBodySchema no longer lists `{required}`, so the API's value for it is refused.");
            Assert.True(
                payload.Contains(required),
                $"The API no longer sends `{required}`. Margins and orientation were dropped here once " +
                "and every atlas printed at 0.5in portrait; overlap was hardcoded to 0 on this same " +
                "payload and 95 of 95 tests stayed green; `title` was absent from this payload for the " +
                "whole life of the API and every atlas was called \"Journey Book\".");
        }
    }

    [Fact]
    public async Task The_payload_carries_no_C_sharp_shaped_name()
    {
        // The worker refuses unknown fields by name, so a PascalCase leak is not a
        // cosmetic problem — it is a 400 on every render. This is the failure the
        // camel-case policy exists to prevent, asserted rather than assumed.
        var payload = await SerializedPayloadFieldsAsync();
        var pascal = payload.Where(f => char.IsUpper(f[0])).ToList();
        Assert.True(pascal.Count == 0, $"PascalCase on the wire: {string.Join(", ", pascal)}");
    }
}

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using JourneyBook.Infrastructure.Tiles;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace JourneyBook.Tests.Api;

/// <summary>
/// <c>POST /api/map-packages</c>: the API asks the worker for a package and registers it when it
/// lands. The worker is faked: "making" a package copies the shared raster fixture into the
/// packages folder, so registration reads a real archive.
/// </summary>
public class MapPackageJobsApiTests(MapPackageJobsApiFactory factory) : IClassFixture<MapPackageJobsApiFactory>
{
    private async Task<MapPackageJobStatus> SettleAsync(HttpClient client, string id)
    {
        for (var i = 0; i < 200; i++)
        {
            var s = (await client.GetFromJsonAsync<MapPackageJobStatus>($"/api/map-packages/jobs/{id}"))!;
            if (s.State is "registered" or "failed") return s;
            await Task.Delay(25);
        }
        throw new TimeoutException("package job never settled");
    }

    [Fact]
    public async Task Makes_a_package_and_registers_it_as_a_tile_source()
    {
        var admin = factory.CreateAdminClient();
        var res = await admin.PostAsJsonAsync("/api/map-packages", new { bbox = new[] { -97.0, 40.5, -96.5, 41.0 }, minZoom = 10, maxZoom = 12, key = "trip-pkg" });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var started = (await res.Content.ReadFromJsonAsync<MapPackageJobStatus>())!;
        Assert.Equal("packaging", started.State);
        Assert.Equal("trip-pkg.pmtiles", started.File);

        // What the worker was asked: through this API's own tile proxy, for the default source.
        var sent = Assert.Single(factory.Worker.Requests, r => r.OutputName == "trip-pkg.pmtiles");
        Assert.Equal(10, sent.MinZoom);
        Assert.Equal(12, sent.MaxZoom);

        var done = await SettleAsync(admin, started.Id);
        Assert.Equal("registered", done.State);
        Assert.Equal("trip-pkg", done.TileSourceKey);
        var row = await admin.GetAsync("/api/tile-sources/by-key/trip-pkg");
        Assert.Equal(HttpStatusCode.OK, row.StatusCode);
    }

    [Fact]
    public async Task A_failed_package_is_reported_with_the_workers_reason_and_registers_nothing()
    {
        var admin = factory.CreateAdminClient();
        var res = await admin.PostAsJsonAsync("/api/map-packages", new { bbox = new[] { -97.0, 40.5, -96.5, 41.0 }, minZoom = 10, maxZoom = 12, key = "fail-pkg" });
        var done = await SettleAsync(admin, (await res.Content.ReadFromJsonAsync<MapPackageJobStatus>())!.Id);

        Assert.Equal("failed", done.State);
        Assert.Contains("tiles failed", done.Error);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/tile-sources/by-key/fail-pkg")).StatusCode);
    }

    [Fact]
    public async Task Refusals_come_back_as_the_worker_gave_them_and_writes_need_the_admin_key()
    {
        var admin = factory.CreateAdminClient();
        var taken = await admin.PostAsJsonAsync("/api/map-packages", new { bbox = new[] { -97.0, 40.5, -96.5, 41.0 }, minZoom = 10, maxZoom = 12, file = "taken.pmtiles" });
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/map-packages", new { bbox = new[] { 1.0 }, minZoom = 10, maxZoom = 12 })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await factory.CreateClient().PostAsJsonAsync("/api/map-packages", new { bbox = new[] { -97.0, 40.5, -96.5, 41.0 }, minZoom = 10, maxZoom = 12 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/map-packages/jobs/nope")).StatusCode);
    }

    /// <summary>
    /// The worker's ajv drops unknown body fields silently, so a C# name that drifts from the
    /// worker's schema would just vanish. Every name the API sends must be one the schema lists.
    /// </summary>
    [Fact]
    public void Every_field_the_api_sends_is_one_the_workers_schema_accepts()
    {
        var json = JsonSerializer.Serialize(
            new PackageWorkerRequest([1, 2, 3, 4], 1, 2, "a.pmtiles", "http://api/tiles", "usgs-topo", 5),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var sent = JsonDocument.Parse(json).RootElement.EnumerateObject().Select(p => p.Name).ToList();

        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "services", "render-worker", "src", "package-route.ts"))) dir = dir.Parent;
        var source = File.ReadAllText(Path.Combine(dir!.FullName, "services", "render-worker", "src", "package-route.ts"));
        var schema = source[source.IndexOf("const bodySchema", StringComparison.Ordinal)..source.IndexOf("} as const;", StringComparison.Ordinal)];
        var accepted = Regex.Matches(schema, @"^\s{4}(\w+): \{", RegexOptions.Multiline).Select(m => m.Groups[1].Value).ToHashSet();

        Assert.True(accepted.Count >= 7, "the worker schema was not read");
        Assert.All(sent, name => Assert.Contains(name, accepted));
    }
}

public class MapPackageJobsApiFactory : PmTilesApiFactory
{
    public FakePackageWorker Worker { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("MapPackages:PollIntervalMs", "10");
        builder.ConfigureTestServices(services =>
        {
            Worker.PackagesDir = PmTilesDir;
            services.RemoveAll<IPackageWorkerClient>();
            services.AddSingleton<IPackageWorkerClient>(Worker);
        });
    }
}

/// <summary>Stands in for the worker: "fail-" keys fail, "taken" is refused, anything else succeeds.</summary>
public sealed class FakePackageWorker : IPackageWorkerClient
{
    public string PackagesDir { get; set; } = "";
    public List<PackageWorkerRequest> Requests { get; } = [];
    private readonly Dictionary<string, PackageWorkerJob> _jobs = [];

    public Task<PackageWorkerJob> StartAsync(PackageWorkerRequest request, CancellationToken ct = default)
    {
        lock (_jobs)
        {
            Requests.Add(request);
            if (request.OutputName == "taken.pmtiles") throw new PackageWorkerRefusedException(409, "A package named taken.pmtiles already exists.");
            var id = Guid.NewGuid().ToString("N");
            if (request.OutputName.StartsWith("fail-", StringComparison.Ordinal))
            {
                _jobs[id] = new PackageWorkerJob(id, "failed", request.OutputName, Error: "3 of 9 tiles failed from usgs-topo, so no package was written.");
            }
            else
            {
                File.Copy(Path.Combine(JourneyBook.Tests.RasterPackageFixtureTests.FixtureDir(), "package.pmtiles"),
                    Path.Combine(PackagesDir, request.OutputName), overwrite: true);
                _jobs[id] = new PackageWorkerJob(id, "completed", request.OutputName, Tiles: 9, Bytes: 1234, TileType: "png");
            }
            return Task.FromResult(new PackageWorkerJob(id, "packaging", request.OutputName));
        }
    }

    public Task<PackageWorkerJob?> GetAsync(string id, CancellationToken ct = default)
    {
        lock (_jobs)
        {
            return Task.FromResult(_jobs.TryGetValue(id, out var j) ? j : null);
        }
    }
}

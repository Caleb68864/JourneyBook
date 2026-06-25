using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.Landmarks;
using JourneyBook.Application.Projects;
using JourneyBook.Application.Rendering;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;

namespace JourneyBook.Tests.Api;

// ── Fake Overpass client (spy) ─────────────────────────────────────────────────

/// <summary>
/// Hand-rolled fake <see cref="IOverpassClient"/> that returns a fixed fixture of
/// <see cref="OverpassPoi"/> rows and records how many times it was queried — so
/// the integration test exercises the import pipeline (tag mapping, culling,
/// scoring, persistence) without ever touching the network. The call counter
/// stands in for mock verification (the test project has no Moq dependency).
/// </summary>
public sealed class FakeOverpassClient : IOverpassClient
{
    public int CallCount { get; private set; }
    public RenderBBoxDto? LastBbox { get; private set; }

    /// <summary>
    /// Fixture: three named peaks (curated <c>natural=peak</c>, survive), one
    /// unnamed park (curated but low-value + no name → dropped), and one building
    /// (uncurated tag → dropped). After import, exactly the three peaks persist.
    /// </summary>
    public static IReadOnlyList<OverpassPoi> Fixture { get; } = new List<OverpassPoi>
    {
        new(-96.70, 40.81, "Mount Logic", Tags("natural", "peak")),
        new(-96.65, 40.85, "Cedar Knob", Tags("natural", "peak")),
        new(-96.60, 40.90, "Signal Hill", Tags("natural", "peak")),
        // Unnamed park: curated leisure=park, but low category value + no name → dropped.
        new(-96.55, 40.95, null, Tags("leisure", "park")),
        // Uncurated building: no curated tag matches → dropped as clutter.
        new(-96.50, 41.00, "Old Warehouse", Tags("building", "yes")),
    };

    public Task<IReadOnlyList<OverpassPoi>> QueryLandmarksAsync(RenderBBoxDto bbox, CancellationToken ct = default)
    {
        CallCount++;
        LastBbox = bbox;
        return Task.FromResult(Fixture);
    }

    private static IReadOnlyDictionary<string, string> Tags(string key, string value) =>
        new Dictionary<string, string> { [key] = value };
}

// ── Factory ─────────────────────────────────────────────────────────────────────

public sealed class LandmarksApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder()
        .WithImage("postgis/postgis:16-3.4")
        .WithDatabase("journeybook")
        .WithUsername("journeybook")
        .WithPassword("journeybook")
        .Build();

    // Set after the first CreateClient() call (triggers ConfigureWebHost).
    public FakeOverpassClient FakeClient { get; private set; } = null!;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Postgres", _db.GetConnectionString());

        builder.ConfigureTestServices(services =>
        {
            // Replace the real typed HttpClient registration with the network-free fake.
            services.RemoveAll<IOverpassClient>();
            FakeClient = new FakeOverpassClient();
            services.AddSingleton<IOverpassClient>(FakeClient);
        });
    }

    public async Task InitializeAsync()
    {
        await _db.StartAsync();
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<JourneyBookDbContext>()
            .Database.MigrateAsync();
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await _db.DisposeAsync();
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

public class LandmarksApiTests(LandmarksApiFactory factory) : IClassFixture<LandmarksApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static readonly RenderBBoxDto Extent = new(-96.75, 40.78, -96.45, 41.05);

    private async Task<Guid> CreateProjectAsync(string name = "Landmarks Host")
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest(name, "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        return created!.Id;
    }

    [Fact]
    public async Task Import_persists_curated_named_landmarks_and_drops_clutter_via_fake_client()
    {
        var before = factory.FakeClient.CallCount;
        var projectId = await CreateProjectAsync();

        var post = await _client.PostAsJsonAsync(
            $"/api/projects/{projectId}/landmarks/import",
            new ImportLandmarksRequest(Extent));
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var result = await post.Content.ReadFromJsonAsync<ImportLandmarksResponse>();
        Assert.NotNull(result);
        // Three named peaks survive; unnamed park and uncurated building are dropped.
        Assert.Equal(3, result!.Imported);
        Assert.Equal(3, result.Landmarks.Count);
        Assert.All(result.Landmarks, l => Assert.Equal("Peak", l.Category));
        Assert.Contains(result.Landmarks, l => l.Name == "Mount Logic");
        Assert.DoesNotContain(result.Landmarks, l => l.Name == "Old Warehouse");

        // The fake — not the network — served the query.
        Assert.True(factory.FakeClient.CallCount > before);
        Assert.Equal(Extent, factory.FakeClient.LastBbox);
    }

    [Fact]
    public async Task Import_persisted_rows_are_listable_ordered_by_score()
    {
        var projectId = await CreateProjectAsync("Landmarks List Host");

        var post = await _client.PostAsJsonAsync(
            $"/api/projects/{projectId}/landmarks/import",
            new ImportLandmarksRequest(Extent));
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var list = await _client.GetFromJsonAsync<List<LandmarkResponse>>(
            $"/api/projects/{projectId}/landmarks");
        Assert.NotNull(list);
        Assert.Equal(3, list!.Count);
        // Deterministic score = category weight (Peak=10) + name bonus (5) = 15.
        Assert.All(list, l => Assert.Equal(15, l.Score));
        // Ordered by descending score (all equal here, but the contract holds).
        for (var i = 1; i < list.Count; i++)
            Assert.True(list[i - 1].Score >= list[i].Score);
    }

    [Fact]
    public async Task Import_under_unknown_project_returns_404()
    {
        var post = await _client.PostAsJsonAsync(
            $"/api/projects/{Guid.NewGuid()}/landmarks/import",
            new ImportLandmarksRequest(Extent));
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);
    }

    [Fact]
    public async Task List_under_unknown_project_returns_404()
    {
        var get = await _client.GetAsync($"/api/projects/{Guid.NewGuid()}/landmarks");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Delete_removes_an_imported_landmark()
    {
        var projectId = await CreateProjectAsync("Landmarks Delete Host");

        var post = await _client.PostAsJsonAsync(
            $"/api/projects/{projectId}/landmarks/import",
            new ImportLandmarksRequest(Extent));
        var result = await post.Content.ReadFromJsonAsync<ImportLandmarksResponse>();
        Assert.NotNull(result);
        var target = result!.Landmarks[0];

        var del = await _client.DeleteAsync($"/api/landmarks/{target.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var list = await _client.GetFromJsonAsync<List<LandmarkResponse>>(
            $"/api/projects/{projectId}/landmarks");
        Assert.NotNull(list);
        Assert.DoesNotContain(list!, l => l.Id == target.Id);
    }

    [Fact]
    public async Task Delete_unknown_landmark_returns_404()
    {
        var del = await _client.DeleteAsync($"/api/landmarks/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, del.StatusCode);
    }
}

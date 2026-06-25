using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.Geocoding;
using JourneyBook.Application.Locations;
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

// ── Fake geocode client (spy) ──────────────────────────────────────────────────

/// <summary>
/// Hand-rolled fake <see cref="IGeocodeClient"/> returning a fixed candidate set and
/// recording the last query + viewbox, so the geocode endpoint is exercised without
/// touching the network (no live Nominatim).
/// </summary>
public sealed class FakeGeocodeClient : IGeocodeClient
{
    public int CallCount { get; private set; }
    public string? LastQuery { get; private set; }
    public RenderBBoxDto? LastViewbox { get; private set; }

    public static IReadOnlyList<GeocodeResultDto> Fixture { get; } = new List<GeocodeResultDto>
    {
        new("Lincoln, Lancaster County, Nebraska, USA", 40.8136, -96.7026, "city", "place"),
        new("Lincoln, Logan County, Illinois, USA", 40.1481, -89.3648, "town", "place"),
    };

    public Task<IReadOnlyList<GeocodeResultDto>> SearchAsync(
        string query, RenderBBoxDto? viewbox = null, CancellationToken ct = default)
    {
        CallCount++;
        LastQuery = query;
        LastViewbox = viewbox;
        return Task.FromResult(Fixture);
    }
}

// ── Factory ─────────────────────────────────────────────────────────────────────

public sealed class GeocodeApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder()
        .WithImage("postgis/postgis:16-3.4")
        .WithDatabase("journeybook")
        .WithUsername("journeybook")
        .WithPassword("journeybook")
        .Build();

    public FakeGeocodeClient FakeClient { get; private set; } = null!;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Postgres", _db.GetConnectionString());

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IGeocodeClient>();
            FakeClient = new FakeGeocodeClient();
            services.AddSingleton<IGeocodeClient>(FakeClient);
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

public class GeocodeApiTests(GeocodeApiFactory factory) : IClassFixture<GeocodeApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Search_returns_candidates_from_the_geocoder()
    {
        var results = await _client.GetFromJsonAsync<List<GeocodeResultDto>>("/api/geocode?q=Lincoln");
        Assert.NotNull(results);
        Assert.Equal(2, results!.Count);
        Assert.Equal("Lincoln, Lancaster County, Nebraska, USA", results[0].DisplayName);
        Assert.Equal(40.8136, results[0].Lat, 4);
        Assert.Equal(-96.7026, results[0].Lng, 4);
        Assert.Equal("Lincoln", factory.FakeClient.LastQuery);
    }

    [Fact]
    public async Task Search_passes_the_viewbox_when_extent_is_given()
    {
        var resp = await _client.GetAsync("/api/geocode?q=park&west=-96.8&south=40.7&east=-96.6&north=40.9");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var vb = factory.FakeClient.LastViewbox;
        Assert.NotNull(vb);
        Assert.Equal(-96.8, vb!.West, 4);
        Assert.Equal(40.9, vb.North, 4);
    }

    [Fact]
    public async Task Search_with_blank_query_returns_400()
    {
        var resp = await _client.GetAsync("/api/geocode?q=");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Location_created_from_a_geocode_result_records_provenance()
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Geocode Host", "usgs-7-5-min"));
        var project = await post.Content.ReadFromJsonAsync<ProjectResponse>();

        var created = await _client.PostAsJsonAsync($"/api/projects/{project!.Id}/locations",
            new CreateLocationRequest("Lincoln", -96.7026, 40.8136,
                GeocodedFrom: "Lincoln, NE", GeocodeProvider: "nominatim"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var body = await created.Content.ReadFromJsonAsync<LocationResponse>();
        Assert.Equal("Lincoln, NE", body!.GeocodedFrom);
        Assert.Equal("nominatim", body.GeocodeProvider);
    }
}

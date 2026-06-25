using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.Locations;
using JourneyBook.Application.Projects;

namespace JourneyBook.Tests.Api;

public class LocationsApiTests(PostgisApiFactory factory) : IClassFixture<PostgisApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<Guid> CreateProjectAsync()
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Locations Host", "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        return created!.Id;
    }

    [Fact]
    public async Task Create_assigns_sequential_L_series_labels()
    {
        var projectId = await CreateProjectAsync();

        var first = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Trailhead", -98.0, 41.0));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var firstBody = await first.Content.ReadFromJsonAsync<LocationResponse>();
        Assert.NotNull(firstBody);
        Assert.Equal(1, firstBody!.LocationNumber);
        Assert.Equal("L1", firstBody.Label);
        Assert.Equal("see page L1", firstBody.ReferenceLabel);

        var second = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Summit", -97.5, 41.5));
        var secondBody = await second.Content.ReadFromJsonAsync<LocationResponse>();
        Assert.NotNull(secondBody);
        Assert.Equal(2, secondBody!.LocationNumber);
        Assert.Equal("L2", secondBody.Label);
        Assert.Equal("see page L2", secondBody.ReferenceLabel);
    }

    [Fact]
    public async Task Coordinates_round_trip_through_postgis()
    {
        var projectId = await CreateProjectAsync();

        const double lng = -98.123456;
        const double lat = 41.654321;
        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Precise Point", lng, lat));
        var created = await post.Content.ReadFromJsonAsync<LocationResponse>();
        Assert.NotNull(created);

        var fetched = await _client.GetFromJsonAsync<LocationResponse>($"/api/locations/{created!.Id}");
        Assert.NotNull(fetched);
        Assert.Equal(lng, fetched!.Lng, 6);
        Assert.Equal(lat, fetched.Lat, 6);
    }

    [Fact]
    public async Task Create_under_unknown_project_returns_404()
    {
        var post = await _client.PostAsJsonAsync($"/api/projects/{Guid.NewGuid()}/locations",
            new CreateLocationRequest("Orphan", -98.0, 41.0));
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);
    }

    [Fact]
    public async Task Create_with_unknown_category_returns_400()
    {
        var projectId = await CreateProjectAsync();

        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Bad Category", -98.0, 41.0, Category: "not-a-category"));
        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
    }

    [Fact]
    public async Task Create_with_per_location_scale_preset_round_trips()
    {
        var projectId = await CreateProjectAsync();

        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Country House", -98.0, 41.0, ScalePresetId: "usgs-7-5-min"));
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);
        var created = await post.Content.ReadFromJsonAsync<LocationResponse>();
        Assert.NotNull(created);
        Assert.Equal("usgs-7-5-min", created!.ScalePresetId);

        // Persists and round-trips on fetch.
        var fetched = await _client.GetFromJsonAsync<LocationResponse>($"/api/locations/{created.Id}");
        Assert.Equal("usgs-7-5-min", fetched!.ScalePresetId);

        // Clearing it on update falls back to the project scale (null).
        var put = await _client.PutAsJsonAsync($"/api/locations/{created.Id}",
            new UpdateLocationRequest("Country House", -98.0, 41.0, "Other", null, "Unknown", ScalePresetId: null));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var updated = await put.Content.ReadFromJsonAsync<LocationResponse>();
        Assert.Null(updated!.ScalePresetId);
    }

    [Fact]
    public async Task Create_with_unknown_scale_preset_returns_400()
    {
        var projectId = await CreateProjectAsync();

        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Bad Scale", -98.0, 41.0, ScalePresetId: "not-a-scale"));
        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
    }

    [Fact]
    public async Task List_returns_locations_ordered_by_L_series()
    {
        var projectId = await CreateProjectAsync();

        await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("One", -98.0, 41.0));
        await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Two", -97.0, 42.0));

        var list = await _client.GetFromJsonAsync<List<LocationResponse>>($"/api/projects/{projectId}/locations");
        Assert.NotNull(list);
        Assert.Equal(2, list!.Count);
        Assert.Equal("L1", list[0].Label);
        Assert.Equal("L2", list[1].Label);
    }

    [Fact]
    public async Task Update_replaces_mutable_fields()
    {
        var projectId = await CreateProjectAsync();

        var post = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("Original", -98.0, 41.0));
        var created = await post.Content.ReadFromJsonAsync<LocationResponse>();

        var put = await _client.PutAsJsonAsync($"/api/locations/{created!.Id}",
            new UpdateLocationRequest("Renamed", -97.0, 42.0, "Other", "updated note", "Unknown"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var updated = await put.Content.ReadFromJsonAsync<LocationResponse>();
        Assert.NotNull(updated);
        Assert.Equal("Renamed", updated!.Name);
        Assert.Equal(-97.0, updated.Lng, 6);
        Assert.Equal(42.0, updated.Lat, 6);
        Assert.Equal("updated note", updated.Notes);
        // L-series label is stable across updates.
        Assert.Equal(created.Label, updated.Label);
    }

    [Fact]
    public async Task Delete_does_not_renumber_remaining_locations()
    {
        var projectId = await CreateProjectAsync();

        var first = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("L1 Point", -98.0, 41.0));
        var firstBody = await first.Content.ReadFromJsonAsync<LocationResponse>();

        var second = await _client.PostAsJsonAsync($"/api/projects/{projectId}/locations",
            new CreateLocationRequest("L2 Point", -97.0, 42.0));
        var secondBody = await second.Content.ReadFromJsonAsync<LocationResponse>();

        var del = await _client.DeleteAsync($"/api/locations/{firstBody!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        // L2 keeps its label — numbers are never reused or renumbered.
        var stillL2 = await _client.GetFromJsonAsync<LocationResponse>($"/api/locations/{secondBody!.Id}");
        Assert.NotNull(stillL2);
        Assert.Equal(2, stillL2!.LocationNumber);
        Assert.Equal("L2", stillL2.Label);
    }

    [Fact]
    public async Task Get_unknown_location_returns_404()
    {
        var get = await _client.GetAsync($"/api/locations/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }
}

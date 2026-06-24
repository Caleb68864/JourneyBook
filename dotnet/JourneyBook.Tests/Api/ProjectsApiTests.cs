using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.Projects;

namespace JourneyBook.Tests.Api;

public class ProjectsApiTests(PostgisApiFactory factory) : IClassFixture<PostgisApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Create_then_get_round_trips()
    {
        var create = new CreateProjectRequest("Road Trip", "usgs-7-5-min", "Portrait", 0.05);
        var post = await _client.PostAsJsonAsync("/api/projects", create);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(created);
        Assert.Equal("Road Trip", created!.Name);
        Assert.Equal("usgs-7-5-min", created.ScalePresetId);
        Assert.Equal(0.05, created.Overlap, 6);

        var get = await _client.GetFromJsonAsync<ProjectResponse>($"/api/projects/{created.Id}");
        Assert.NotNull(get);
        Assert.Equal(created.Id, get!.Id);
    }

    [Fact]
    public async Task Create_with_unknown_scale_returns_400()
    {
        var create = new CreateProjectRequest("Bad", "not-a-scale");
        var post = await _client.PostAsJsonAsync("/api/projects", create);
        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
    }

    [Fact]
    public async Task Set_extent_persists_the_bbox()
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Extent Test", "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();

        var bbox = new BBoxDto(-98.1, 40.9, -97.9, 41.1);
        var put = await _client.PutAsJsonAsync($"/api/projects/{created!.Id}/extent", bbox);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var updated = await put.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotNull(updated!.Extent);
        Assert.Equal(-98.1, updated.Extent!.West, 6);
        Assert.Equal(40.9, updated.Extent.South, 6);
        Assert.Equal(-97.9, updated.Extent.East, 6);
        Assert.Equal(41.1, updated.Extent.North, 6);

        // Extent survives a reload (round-trips through PostGIS).
        var reloaded = await _client.GetFromJsonAsync<ProjectResponse>($"/api/projects/{created.Id}");
        Assert.Equal(-98.1, reloaded!.Extent!.West, 6);
    }

    [Fact]
    public async Task Delete_removes_the_project()
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Throwaway", "usgs-7-5-min"));
        var created = await post.Content.ReadFromJsonAsync<ProjectResponse>();

        var del = await _client.DeleteAsync($"/api/projects/{created!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var get = await _client.GetAsync($"/api/projects/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }
}

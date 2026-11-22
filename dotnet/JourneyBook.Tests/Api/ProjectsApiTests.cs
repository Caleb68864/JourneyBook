using System.Net;
using System.Net.Http.Json;
using JourneyBook.Application.Locations;
using JourneyBook.Application.Projects;
using JourneyBook.Application.Common;

namespace JourneyBook.Tests.Api;

public class ProjectsApiTests(PostgisApiFactory factory) : IClassFixture<PostgisApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Duplicate_deep_copies_grid_extent_and_locations()
    {
        var post = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Original Trip", "usgs-7-5-min", "Portrait", 0.05));
        var src = await post.Content.ReadFromJsonAsync<ProjectResponse>();

        await _client.PutAsJsonAsync($"/api/projects/{src!.Id}/extent",
            new BBoxDto(-96.8, 40.7, -96.6, 40.9));
        await _client.PostAsJsonAsync($"/api/projects/{src.Id}/locations",
            new CreateLocationRequest("Home", -96.7, 40.8, PinShape: "teardrop", PinColor: "#c25e1d",
                ZoomLevels: ["1-100000", "usgs-7-5-min"]));

        var dup = await _client.PostAsync($"/api/projects/{src.Id}/duplicate", null);
        Assert.Equal(HttpStatusCode.Created, dup.StatusCode);
        var copy = await dup.Content.ReadFromJsonAsync<ProjectResponse>();
        Assert.NotEqual(src.Id, copy!.Id);
        Assert.Equal("Original Trip (copy)", copy.Name);
        Assert.Equal("usgs-7-5-min", copy.ScalePresetId);
        Assert.NotNull(copy.Extent); // extent copied

        var locs = await _client.GetFromJsonAsync<List<LocationResponse>>($"/api/projects/{copy.Id}/locations");
        Assert.Single(locs!);
        Assert.Equal("Home", locs![0].Name);
        Assert.Equal("teardrop", locs[0].PinShape); // pin copied
        // The ladder is copied as a new array, not aliased to the original's.
        Assert.Equal(new[] { "1-100000", "usgs-7-5-min" }, locs[0].ZoomLevels);
    }

    [Fact]
    public async Task Duplicate_unknown_project_returns_404()
    {
        var dup = await _client.PostAsync($"/api/projects/{System.Guid.NewGuid()}/duplicate", null);
        Assert.Equal(HttpStatusCode.NotFound, dup.StatusCode);
    }

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

    [Fact]
    public async Task Title_page_fields_round_trip_clear_and_survive_duplicate()
    {
        var create = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Title Page", "usgs-7-5-min", ExplorerName: "  Ada ", AtlasDate: "Summer 2026"));
        var created = (await create.Content.ReadFromJsonAsync<ProjectResponse>())!;
        Assert.Equal("Ada", created.ExplorerName);
        Assert.Equal("Summer 2026", created.AtlasDate);

        var duplicate = await _client.PostAsync($"/api/projects/{created.Id}/duplicate", null);
        var copy = (await duplicate.Content.ReadFromJsonAsync<ProjectResponse>())!;
        Assert.Equal("Ada", copy.ExplorerName);
        Assert.Equal("Summer 2026", copy.AtlasDate);

        var update = await _client.PutAsJsonAsync($"/api/projects/{created.Id}",
            new UpdateProjectRequest("Title Page", "usgs-7-5-min", "Portrait", 0, created.Margins,
                ExplorerName: "   ", AtlasDate: "Fall 2026"));
        var updated = (await update.Content.ReadFromJsonAsync<ProjectResponse>())!;
        Assert.Null(updated.ExplorerName);
        Assert.Equal("Fall 2026", updated.AtlasDate);
    }

    [Fact]
    public async Task An_over_long_explorer_name_is_a_400_not_a_database_error()
    {
        var response = await _client.PostAsJsonAsync("/api/projects",
            new CreateProjectRequest("Too Long", "usgs-7-5-min", ExplorerName: new string('x', 121)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Saved worksheet legs ──────────────────────────────────────────────────

    private async Task<(ProjectResponse Project, Guid A, Guid B)> ProjectWithTwoStopsAsync(string name)
    {
        var post = await _client.PostAsJsonAsync("/api/projects", new CreateProjectRequest(name, "usgs-7-5-min"));
        var project = (await post.Content.ReadFromJsonAsync<ProjectResponse>())!;
        var ids = new List<Guid>();
        foreach (var (n, lng) in new[] { ("A", -96.70), ("B", -96.71) })
        {
            var loc = await _client.PostAsJsonAsync($"/api/projects/{project.Id}/locations", new CreateLocationRequest(n, lng, 40.81));
            ids.Add((await loc.Content.ReadFromJsonAsync<LocationResponse>())!.Id);
        }
        return (project, ids[0], ids[1]);
    }

    private UpdateProjectRequest Put(ProjectResponse p, IReadOnlyList<WorksheetLegDto>? legs) =>
        new(p.Name, "usgs-7-5-min", "Portrait", 0, p.Margins, WorksheetLegs: legs);

    [Fact]
    public async Task Worksheet_legs_are_saved_with_the_project_and_null_leaves_them_alone()
    {
        var (project, a, b) = await ProjectWithTwoStopsAsync("Saved Legs");
        var legs = new[] { new WorksheetLegDto($"loc:{b}", $"loc:{a}"), new WorksheetLegDto($"loc:{a}", "lm:Water Tower") };

        var put = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, legs));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var got = await _client.GetFromJsonAsync<ProjectResponse>($"/api/projects/{project.Id}");
        Assert.Equal(legs, got!.WorksheetLegs);

        // A client that does not send the field (an older one, or a rename) keeps them.
        var rename = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, null) with { Name = "Renamed" });
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);
        Assert.Equal(legs, (await rename.Content.ReadFromJsonAsync<ProjectResponse>())!.WorksheetLegs);

        // An empty list clears them.
        var clear = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, []));
        Assert.Empty((await clear.Content.ReadFromJsonAsync<ProjectResponse>())!.WorksheetLegs!);
    }

    [Fact]
    public async Task Worksheet_legs_must_name_this_projects_places()
    {
        var (project, a, _) = await ProjectWithTwoStopsAsync("Bad Legs");
        var (other, foreign, _) = await ProjectWithTwoStopsAsync("Someone Else");
        foreach (var bad in new[]
        {
            new WorksheetLegDto($"loc:{a}", $"loc:{foreign}"), // another project's location
            new WorksheetLegDto($"loc:{a}", "L2"),              // positional: rebinds when one is deleted
            new WorksheetLegDto($"loc:{a}", "lm:"),
            new WorksheetLegDto("", $"loc:{a}"),
        })
        {
            var res = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, [bad]));
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
        var tooMany = Enumerable.Range(0, 51).Select(_ => new WorksheetLegDto($"loc:{a}", "lm:X")).ToList();
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, tooMany))).StatusCode);
        Assert.NotEqual(Guid.Empty, other.Id);
    }

    [Fact]
    public async Task Deleting_a_location_drops_its_saved_legs_and_duplicating_carries_them_to_the_copy()
    {
        var (project, a, b) = await ProjectWithTwoStopsAsync("Legs Follow Places");
        var legs = new[] { new WorksheetLegDto($"loc:{a}", $"loc:{b}"), new WorksheetLegDto($"loc:{b}", "lm:Water Tower") };
        Assert.Equal(HttpStatusCode.OK, (await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, legs))).StatusCode);

        // Duplicate: the legs point at the copy's own locations, by L-number.
        var dup = await _client.PostAsync($"/api/projects/{project.Id}/duplicate", null);
        var copy = (await dup.Content.ReadFromJsonAsync<ProjectResponse>())!;
        var copyLocs = (await _client.GetFromJsonAsync<List<LocationResponse>>($"/api/projects/{copy.Id}/locations"))!;
        var (ca, cb) = (copyLocs.Single(l => l.Name == "A").Id, copyLocs.Single(l => l.Name == "B").Id);
        Assert.Equal([new WorksheetLegDto($"loc:{ca}", $"loc:{cb}"), new WorksheetLegDto($"loc:{cb}", "lm:Water Tower")], copy.WorksheetLegs);

        // Delete A: only the leg that does not touch it survives.
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/locations/{a}")).StatusCode);
        var after = await _client.GetFromJsonAsync<ProjectResponse>($"/api/projects/{project.Id}");
        Assert.Equal([new WorksheetLegDto($"loc:{b}", "lm:Water Tower")], after!.WorksheetLegs);
    }

    [Fact]
    public async Task Tier_and_worksheet_switches_are_saved_kept_by_null_and_copied_on_duplicate()
    {
        var (project, _, _) = await ProjectWithTwoStopsAsync("Saved Choices");
        Assert.Null(project.MapTier);
        Assert.False(project.Worksheet);
        Assert.False(project.WorksheetLandmarks);

        var put = await _client.PutAsJsonAsync($"/api/projects/{project.Id}",
            Put(project, null) with { MapTier = 4, Worksheet = true, WorksheetLandmarks = true });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var got = await _client.GetFromJsonAsync<ProjectResponse>($"/api/projects/{project.Id}");
        Assert.Equal((4, true, true), (got!.MapTier, got.Worksheet, got.WorksheetLandmarks));

        // A save that does not send them (a rename, an older client) keeps them.
        var rename = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, null) with { Name = "Renamed" });
        var kept = (await rename.Content.ReadFromJsonAsync<ProjectResponse>())!;
        Assert.Equal((4, true, true), (kept.MapTier, kept.Worksheet, kept.WorksheetLandmarks));

        var copy = (await (await _client.PostAsync($"/api/projects/{project.Id}/duplicate", null)).Content.ReadFromJsonAsync<ProjectResponse>())!;
        Assert.Equal((4, true, true), (copy.MapTier, copy.Worksheet, copy.WorksheetLandmarks));

        foreach (var bad in new[] { 0, 5 })
        {
            var res = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", Put(project, null) with { MapTier = bad });
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        }
    }
}

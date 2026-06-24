namespace JourneyBook.Application.Projects;

/// <summary>Thrown for invalid project input (e.g. unknown scale preset).</summary>
public class ProjectValidationException(string message) : Exception(message);

/// <summary>
/// Use-cases for atlas projects and their extent. Single-user MVP — no owner
/// scoping. Page-grid derivation lives in the TS atlas-core engine, not here;
/// this layer persists project + extent + grid configuration only.
/// </summary>
public interface IProjectService
{
    Task<ProjectResponse> CreateAsync(CreateProjectRequest request, CancellationToken ct = default);
    Task<ProjectResponse?> GetAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<ProjectResponse>> ListAsync(CancellationToken ct = default);
    Task<ProjectResponse?> UpdateAsync(Guid id, UpdateProjectRequest request, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);

    /// <summary>Set (or replace) the project's atlas extent from a WGS84 bbox.</summary>
    Task<ProjectResponse?> SetExtentAsync(Guid id, BBoxDto bbox, CancellationToken ct = default);
}

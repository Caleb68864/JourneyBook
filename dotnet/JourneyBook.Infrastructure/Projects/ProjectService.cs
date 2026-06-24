using JourneyBook.Application.Projects;
using JourneyBook.Domain.Entities;
using JourneyBook.Domain.ValueObjects;
using JourneyBook.Domain;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite;
using NetTopologySuite.Geometries;

namespace JourneyBook.Infrastructure.Projects;

public class ProjectService(JourneyBookDbContext db) : IProjectService
{
    public async Task<ProjectResponse> CreateAsync(CreateProjectRequest request, CancellationToken ct = default)
    {
        await EnsureScalePresetAsync(request.ScalePresetId, ct);
        var now = DateTimeOffset.UtcNow;

        var project = new Project
        {
            Name = request.Name,
            CreatedAt = now,
            UpdatedAt = now,
            PageGrid = new AtlasPageGrid
            {
                ScalePresetId = request.ScalePresetId,
                Orientation = ParseOrientation(request.Orientation),
                Overlap = request.Overlap,
                Margins = ToMargins(request.Margins),
            },
        };

        db.Projects.Add(project);
        await db.SaveChangesAsync(ct);
        return ToResponse(project);
    }

    public async Task<ProjectResponse?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var project = await LoadAsync(id, ct);
        return project is null ? null : ToResponse(project);
    }

    public async Task<IReadOnlyList<ProjectResponse>> ListAsync(CancellationToken ct = default)
    {
        var projects = await db.Projects
            .Include(p => p.PageGrid)
            .Include(p => p.Extent)
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync(ct);
        return projects.Select(ToResponse).ToList();
    }

    public async Task<ProjectResponse?> UpdateAsync(Guid id, UpdateProjectRequest request, CancellationToken ct = default)
    {
        var project = await LoadAsync(id, ct);
        if (project is null) return null;
        await EnsureScalePresetAsync(request.ScalePresetId, ct);

        project.Name = request.Name;
        project.UpdatedAt = DateTimeOffset.UtcNow;
        project.PageGrid ??= new AtlasPageGrid { ScalePresetId = request.ScalePresetId };
        project.PageGrid.ScalePresetId = request.ScalePresetId;
        project.PageGrid.Orientation = ParseOrientation(request.Orientation);
        project.PageGrid.Overlap = request.Overlap;
        project.PageGrid.Margins = ToMargins(request.Margins);

        await db.SaveChangesAsync(ct);
        return ToResponse(project);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (project is null) return false;
        db.Projects.Remove(project);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<ProjectResponse?> SetExtentAsync(Guid id, BBoxDto bbox, CancellationToken ct = default)
    {
        var project = await LoadAsync(id, ct);
        if (project is null) return null;

        var polygon = ToPolygon(bbox);
        if (project.Extent is null)
        {
            project.Extent = new AtlasExtent { Bounds = polygon };
        }
        else
        {
            project.Extent.Bounds = polygon;
        }
        project.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return ToResponse(project);
    }

    // --- helpers ----------------------------------------------------------

    private Task<Project?> LoadAsync(Guid id, CancellationToken ct) =>
        db.Projects
            .Include(p => p.PageGrid)
            .Include(p => p.Extent)
            .FirstOrDefaultAsync(p => p.Id == id, ct);

    private async Task EnsureScalePresetAsync(string scalePresetId, CancellationToken ct)
    {
        if (!await db.ScalePresets.AnyAsync(s => s.Id == scalePresetId, ct))
        {
            throw new ProjectValidationException($"Unknown scale preset '{scalePresetId}'.");
        }
    }

    private static PageOrientation ParseOrientation(string value) =>
        Enum.TryParse<PageOrientation>(value, ignoreCase: true, out var o)
            ? o
            : throw new ProjectValidationException($"Invalid orientation '{value}'.");

    private static PageMargins ToMargins(MarginsDto? dto) =>
        dto is null
            ? new PageMargins()
            : new PageMargins { Top = dto.Top, Right = dto.Right, Bottom = dto.Bottom, Left = dto.Left, Gutter = dto.Gutter };

    private static Polygon ToPolygon(BBoxDto b)
    {
        var gf = NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326);
        var ring = gf.CreateLinearRing(
        [
            new Coordinate(b.West, b.South),
            new Coordinate(b.East, b.South),
            new Coordinate(b.East, b.North),
            new Coordinate(b.West, b.North),
            new Coordinate(b.West, b.South),
        ]);
        return gf.CreatePolygon(ring);
    }

    private static ProjectResponse ToResponse(Project p)
    {
        var grid = p.PageGrid;
        var margins = grid?.Margins ?? new PageMargins();
        BBoxDto? extent = null;
        if (p.Extent is not null)
        {
            var env = p.Extent.Bounds.EnvelopeInternal;
            extent = new BBoxDto(env.MinX, env.MinY, env.MaxX, env.MaxY);
        }

        return new ProjectResponse(
            p.Id,
            p.Name,
            grid?.ScalePresetId ?? string.Empty,
            (grid?.Orientation ?? PageOrientation.Portrait).ToString(),
            grid?.Overlap ?? 0,
            new MarginsDto(margins.Top, margins.Right, margins.Bottom, margins.Left, margins.Gutter),
            extent,
            p.CreatedAt,
            p.UpdatedAt);
    }
}

using JourneyBook.Application.Projects;
using JourneyBook.Domain.Entities;
using JourneyBook.Domain.ValueObjects;
using JourneyBook.Domain;
using JourneyBook.Infrastructure.GeneratedPdfs;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite;
using NetTopologySuite.Geometries;
using JourneyBook.Application.Common;

namespace JourneyBook.Infrastructure.Projects;

public class ProjectService(JourneyBookDbContext db, GeneratedPdfArtifacts artifacts) : IProjectService
{
    public async Task<ProjectResponse> CreateAsync(CreateProjectRequest request, CancellationToken ct = default)
    {
        await EnsureScalePresetAsync(request.ScalePresetId, ct);
        var now = DateTimeOffset.UtcNow;

        var project = new Project
        {
            Name = request.Name,
            ExplorerName = TitlePageText(request.ExplorerName, "Explorer name", ProjectLimits.ExplorerNameMaxLength),
            AtlasDate = TitlePageText(request.AtlasDate, "Date", ProjectLimits.AtlasDateMaxLength),
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
        project.ExplorerName = TitlePageText(request.ExplorerName, "Explorer name", ProjectLimits.ExplorerNameMaxLength);
        project.AtlasDate = TitlePageText(request.AtlasDate, "Date", ProjectLimits.AtlasDateMaxLength);
        if (request.WorksheetLegs is { } legs)
            project.WorksheetLegs = await ValidLegsAsync(project.Id, legs, ct);
        if (request.MapTier is { } tier)
            project.MapTier = tier is >= 1 and <= 4 ? tier : throw new ProjectValidationException($"Map tier must be 1–4 (got {tier}).");
        if (request.Worksheet is { } worksheet) project.Worksheet = worksheet;
        if (request.WorksheetLandmarks is { } worksheetLandmarks) project.WorksheetLandmarks = worksheetLandmarks;
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
        // The project's generated-PDF rows go by database cascade, which knows nothing
        // about the files they point at; those used to stay on disk for ever. Read the
        // paths first, delete the files only once the rows are gone.
        var files = await db.GeneratedPdfs
            .Where(g => g.ProjectId == id && g.FilePath != null)
            .Select(g => g.FilePath)
            .ToListAsync(ct);
        db.Projects.Remove(project);
        await db.SaveChangesAsync(ct);
        foreach (var file in files)
        {
            artifacts.TryDelete(file);
        }
        return true;
    }

    public async Task<ProjectResponse?> DuplicateAsync(Guid id, CancellationToken ct = default)
    {
        var source = await db.Projects
            .Include(p => p.PageGrid)
            .Include(p => p.Extent)
            .Include(p => p.Locations)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (source is null) return null;

        var now = DateTimeOffset.UtcNow;
        var copy = new Project
        {
            Name = $"{source.Name} (copy)",
            ExplorerName = source.ExplorerName,
            AtlasDate = source.AtlasDate,
            MapTier = source.MapTier,
            Worksheet = source.Worksheet,
            WorksheetLandmarks = source.WorksheetLandmarks,
            CreatedAt = now,
            UpdatedAt = now,
            PageGrid = source.PageGrid is null ? null : new AtlasPageGrid
            {
                ScalePresetId = source.PageGrid.ScalePresetId,
                Orientation = source.PageGrid.Orientation,
                Overlap = source.PageGrid.Overlap,
                Margins = CopyMargins(source.PageGrid.Margins),
            },
            Extent = source.Extent is null ? null : new AtlasExtent { Bounds = (Polygon)source.Extent.Bounds.Copy() },
            Locations = source.Locations
                .OrderBy(l => l.LocationNumber)
                .Select(l => new ImportantLocation
                {
                    Name = l.Name,
                    Location = (Point)l.Location.Copy(),
                    Category = l.Category,
                    Notes = l.Notes,
                    SourceConfidence = l.SourceConfidence,
                    ScalePresetId = l.ScalePresetId,
                    // Copy the array, don't share the reference: two projects must not
                    // alias one ladder, or editing the copy would mutate the original.
                    ZoomLevels = l.ZoomLevels?.ToArray(),
                    PinShape = l.PinShape,
                    PinColor = l.PinColor,
                    GeocodedFrom = l.GeocodedFrom,
                    GeocodeProvider = l.GeocodeProvider,
                    LocationNumber = l.LocationNumber,
                })
                .ToList(),
        };

        db.Projects.Add(copy);
        await db.SaveChangesAsync(ct);

        // Saved legs follow their places onto the copy: each source location id maps to the
        // copied location with the same L-number (ids are new). Landmarks are not copied, so a
        // landmark end is kept by name and resolves if the copy imports landmarks again.
        if (source.WorksheetLegs.Count > 0)
        {
            var byNumber = copy.Locations.ToDictionary(l => l.LocationNumber, l => l.Id);
            var idMap = source.Locations.ToDictionary(l => $"loc:{l.Id}", l => byNumber.TryGetValue(l.LocationNumber, out var n) ? $"loc:{n}" : null);
            string? Map(string end) => end.StartsWith("loc:", StringComparison.Ordinal) ? idMap.GetValueOrDefault(end) : end;
            copy.WorksheetLegs = source.WorksheetLegs
                .Select(l => (From: Map(l.From), To: Map(l.To)))
                .Where(l => l.From is not null && l.To is not null)
                .Select(l => new WorksheetLegRef(l.From!, l.To!))
                .ToList();
            await db.SaveChangesAsync(ct);
        }
        return ToResponse(copy);
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

    /// <summary>Trimmed, with blank meaning absent; too long is a 400, not a database error.</summary>
    private static string? TitlePageText(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length <= maxLength
            ? trimmed
            : throw new ProjectValidationException($"{field} must be {maxLength} characters or fewer.");
    }

    private static PageMargins CopyMargins(PageMargins m) =>
        new() { Top = m.Top, Right = m.Right, Bottom = m.Bottom, Left = m.Left, Gutter = m.Gutter };

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
            p.UpdatedAt,
            p.ExplorerName,
            p.AtlasDate,
            p.WorksheetLegs.Select(l => new WorksheetLegDto(l.From, l.To)).ToList(),
            p.MapTier,
            p.Worksheet,
            p.WorksheetLandmarks);
    }

    /// <summary>
    /// The legs to save, or a <see cref="ProjectValidationException"/> (400). Each end must be
    /// "loc:&lt;id&gt;" for a location of this project, or "lm:&lt;name&gt;"; at most 50 legs.
    /// </summary>
    private async Task<List<WorksheetLegRef>> ValidLegsAsync(Guid projectId, IReadOnlyList<WorksheetLegDto> legs, CancellationToken ct)
    {
        if (legs.Count > ProjectLimits.MaxWorksheetLegs)
            throw new ProjectValidationException($"At most {ProjectLimits.MaxWorksheetLegs} worksheet legs (got {legs.Count}).");
        var locationIds = (await db.ImportantLocations.Where(l => l.ProjectId == projectId).Select(l => l.Id).ToListAsync(ct)).ToHashSet();
        string Check(string? end)
        {
            var e = (end ?? "").Trim();
            if (e.Length == 0 || e.Length > ProjectLimits.WorksheetLegRefMaxLength)
                throw new ProjectValidationException("A worksheet leg end is empty or too long.");
            if (e.StartsWith("loc:", StringComparison.Ordinal))
            {
                if (!Guid.TryParse(e[4..], out var id) || !locationIds.Contains(id))
                    throw new ProjectValidationException($"Worksheet leg end \"{e}\" is not a location of this project.");
                return e;
            }
            if (e.StartsWith("lm:", StringComparison.Ordinal) && e.Length > 3) return e;
            throw new ProjectValidationException($"Worksheet leg end \"{e}\" must be loc:<location id> or lm:<landmark name>.");
        }
        return legs.Select(l => new WorksheetLegRef(Check(l.From), Check(l.To))).ToList();
    }
}

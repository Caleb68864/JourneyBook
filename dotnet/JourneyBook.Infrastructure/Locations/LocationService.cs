using JourneyBook.Application.Locations;
using JourneyBook.Domain;
using JourneyBook.Domain.Entities;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite;
using NetTopologySuite.Geometries;

namespace JourneyBook.Infrastructure.Locations;

public class LocationService(JourneyBookDbContext db) : ILocationService
{
    public async Task<LocationResponse?> CreateAsync(Guid projectId, CreateLocationRequest request, CancellationToken ct = default)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == projectId, ct))
        {
            return null;
        }

        var category = ParseCategory(request.Category);
        var sourceConfidence = ParseSourceConfidence(request.SourceConfidence);
        await ValidateScalePresetAsync(request.ScalePresetId, ct);

        var maxNumber = await db.ImportantLocations
            .Where(l => l.ProjectId == projectId)
            .Select(l => (int?)l.LocationNumber)
            .MaxAsync(ct) ?? 0;

        var location = new ImportantLocation
        {
            ProjectId = projectId,
            Name = request.Name,
            Location = ToPoint(request.Lng, request.Lat),
            Category = category,
            Notes = request.Notes,
            SourceConfidence = sourceConfidence,
            ScalePresetId = request.ScalePresetId,
            LocationNumber = maxNumber + 1,
        };

        db.ImportantLocations.Add(location);
        await db.SaveChangesAsync(ct);
        return ToResponse(location);
    }

    public async Task<IReadOnlyList<LocationResponse>?> ListAsync(Guid projectId, CancellationToken ct = default)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == projectId, ct))
        {
            return null;
        }

        var locations = await db.ImportantLocations
            .Where(l => l.ProjectId == projectId)
            .OrderBy(l => l.LocationNumber)
            .ToListAsync(ct);
        return locations.Select(ToResponse).ToList();
    }

    public async Task<LocationResponse?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var location = await db.ImportantLocations.FirstOrDefaultAsync(l => l.Id == id, ct);
        return location is null ? null : ToResponse(location);
    }

    public async Task<LocationResponse?> UpdateAsync(Guid id, UpdateLocationRequest request, CancellationToken ct = default)
    {
        var location = await db.ImportantLocations.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (location is null) return null;

        var category = ParseCategory(request.Category);
        var sourceConfidence = ParseSourceConfidence(request.SourceConfidence);
        await ValidateScalePresetAsync(request.ScalePresetId, ct);

        location.Name = request.Name;
        location.Location = ToPoint(request.Lng, request.Lat);
        location.Category = category;
        location.Notes = request.Notes;
        location.SourceConfidence = sourceConfidence;
        location.ScalePresetId = request.ScalePresetId;

        await db.SaveChangesAsync(ct);
        return ToResponse(location);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var location = await db.ImportantLocations.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (location is null) return false;
        db.ImportantLocations.Remove(location);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // --- helpers ----------------------------------------------------------

    private static Point ToPoint(double lng, double lat) =>
        NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326)
            .CreatePoint(new Coordinate(lng, lat));

    private static LocationCategory ParseCategory(string value) =>
        Enum.TryParse<LocationCategory>(value, ignoreCase: true, out var c)
            ? c
            : throw new LocationValidationException($"Invalid category '{value}'.");

    private static SourceConfidence ParseSourceConfidence(string value) =>
        Enum.TryParse<SourceConfidence>(value, ignoreCase: true, out var s)
            ? s
            : throw new LocationValidationException($"Invalid source confidence '{value}'.");

    /// <summary>
    /// A per-location scale override must reference a seeded scale preset (or be
    /// null = inherit the project scale). Rejects unknown ids → 400, like Category.
    /// </summary>
    private async Task ValidateScalePresetAsync(string? scalePresetId, CancellationToken ct)
    {
        if (scalePresetId is null) return;
        if (!await db.ScalePresets.AnyAsync(s => s.Id == scalePresetId, ct))
            throw new LocationValidationException($"Invalid scale preset '{scalePresetId}'.");
    }

    private static LocationResponse ToResponse(ImportantLocation l) =>
        new(
            l.Id,
            l.ProjectId,
            l.Name,
            l.Location.X,
            l.Location.Y,
            l.Category.ToString(),
            l.Notes,
            l.SourceConfidence.ToString(),
            l.LocationNumber,
            $"L{l.LocationNumber}",
            $"see page L{l.LocationNumber}",
            l.GeocodedFrom,
            l.GeocodeProvider,
            l.ScalePresetId);
}

using JourneyBook.Application.TileSources;
using JourneyBook.Domain.Entities;
using JourneyBook.Domain.ValueObjects;
using JourneyBook.Infrastructure.Persistence;
using JourneyBook.Infrastructure.Tiles;
using Microsoft.EntityFrameworkCore;

namespace JourneyBook.Infrastructure.TileSources;

public class TileSourceService(JourneyBookDbContext db, TileEgressPolicy egressPolicy) : ITileSourceService
{
    /// <summary>
    /// Refuse a SourceUrl the server would not be allowed to fetch, at the moment
    /// it is stored rather than at the moment it is used.
    ///
    /// <para>
    /// This is the friendly half of the SSRF fix, not the load-bearing half: it
    /// gives whoever registers a source an immediate, readable error instead of a
    /// 502 the next time somebody requests a tile. It cannot be the real defence,
    /// because a hostname that resolves to a public address now can resolve to
    /// 127.0.0.1 later — that is what the connect-time check in
    /// <c>TileEgressPolicy.IsBlockedAddress</c> is for.
    /// </para>
    /// </summary>
    private void EnsureUrlAllowed(string? sourceUrl, string? kind)
    {
        if (!egressPolicy.TryValidateTemplate(sourceUrl, kind, out var reason))
        {
            throw new TileSourceUrlPolicyException(reason);
        }
    }

    public async Task<TileSourceResponse> CreateAsync(CreateTileSourceRequest request, CancellationToken ct = default)
    {
        EnsureUrlAllowed(request.SourceUrl, request.Kind);

        if (await db.TileSources.AnyAsync(t => t.Key == request.Key, ct))
            throw new TileSourceValidationException($"A tile source with key '{request.Key}' already exists.");

        var entity = new TileSource
        {
            Key = request.Key,
            Provider = request.Provider,
            SourceUrl = request.SourceUrl,
            Attribution = request.Attribution,
            MaxZoom = request.MaxZoom,
            Kind = request.Kind,
            Version = request.Version,
            SourceDate = request.SourceDate,
            Cache = new TileCachePolicy
            {
                MaxAgeSeconds = request.Cache.MaxAgeSeconds,
                OfflineAllowed = request.Cache.OfflineAllowed
            }
        };

        db.TileSources.Add(entity);
        await db.SaveChangesAsync(ct);
        return ToResponse(entity);
    }

    public async Task<IReadOnlyList<TileSourceResponse>> ListAsync(CancellationToken ct = default)
    {
        var all = await db.TileSources.OrderBy(t => t.Key).ToListAsync(ct);
        return all.Select(ToResponse).ToList();
    }

    public async Task<TileSourceResponse?> GetAsync(Guid id, CancellationToken ct = default)
    {
        var entity = await db.TileSources.FindAsync([id], ct);
        return entity is null ? null : ToResponse(entity);
    }

    public async Task<TileSourceResponse?> GetByKeyAsync(string key, CancellationToken ct = default)
    {
        var entity = await db.TileSources.FirstOrDefaultAsync(t => t.Key == key, ct);
        return entity is null ? null : ToResponse(entity);
    }

    public async Task<TileSourceResponse?> UpdateAsync(Guid id, UpdateTileSourceRequest request, CancellationToken ct = default)
    {
        EnsureUrlAllowed(request.SourceUrl, request.Kind);

        var entity = await db.TileSources.FindAsync([id], ct);
        if (entity is null) return null;

        entity.Provider = request.Provider;
        entity.SourceUrl = request.SourceUrl;
        entity.Attribution = request.Attribution;
        entity.MaxZoom = request.MaxZoom;
        entity.Kind = request.Kind;
        entity.Version = request.Version;
        entity.SourceDate = request.SourceDate;
        entity.Cache = new TileCachePolicy
        {
            MaxAgeSeconds = request.Cache.MaxAgeSeconds,
            OfflineAllowed = request.Cache.OfflineAllowed
        };

        await db.SaveChangesAsync(ct);
        return ToResponse(entity);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var entity = await db.TileSources.FindAsync([id], ct);
        if (entity is null) return false;

        db.TileSources.Remove(entity);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private static TileSourceResponse ToResponse(TileSource t) => new(
        t.Id,
        t.Key,
        t.Provider,
        t.SourceUrl,
        t.Version,
        t.SourceDate,
        t.Attribution,
        t.MaxZoom,
        new TileCachePolicyDto(t.Cache.MaxAgeSeconds, t.Cache.OfflineAllowed),
        t.Kind);
}

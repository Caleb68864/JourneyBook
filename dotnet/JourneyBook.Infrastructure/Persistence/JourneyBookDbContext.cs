using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace JourneyBook.Infrastructure.Persistence;

/// <summary>
/// EF Core context for Journey Book. Stage 2A: project metadata schema —
/// projects, atlas extents, page grids/pages, important locations, tile
/// sources, generated PDFs, and seeded scale presets. PostGIS geometry via
/// NetTopologySuite.
/// </summary>
public class JourneyBookDbContext(DbContextOptions<JourneyBookDbContext> options)
    : DbContext(options)
{
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<AtlasExtent> AtlasExtents => Set<AtlasExtent>();
    public DbSet<AtlasPageGrid> AtlasPageGrids => Set<AtlasPageGrid>();
    public DbSet<AtlasPage> AtlasPages => Set<AtlasPage>();
    public DbSet<ImportantLocation> ImportantLocations => Set<ImportantLocation>();
    public DbSet<Landmark> Landmarks => Set<Landmark>();
    public DbSet<TileSource> TileSources => Set<TileSource>();
    public DbSet<GeneratedPdf> GeneratedPdfs => Set<GeneratedPdf>();
    public DbSet<ScalePreset> ScalePresets => Set<ScalePreset>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // PostGIS must be enabled before any geometry column is created.
        modelBuilder.HasPostgresExtension("postgis");

        // Picks up IEntityTypeConfiguration<T> classes as entities are added.
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(JourneyBookDbContext).Assembly);
    }
}

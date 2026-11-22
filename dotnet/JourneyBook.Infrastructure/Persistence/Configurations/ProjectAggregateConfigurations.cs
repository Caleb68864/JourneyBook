using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace JourneyBook.Infrastructure.Persistence.Configurations;

public class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.Property(p => p.Name).IsRequired().HasMaxLength(200);
        builder.Property(p => p.ExplorerName).HasMaxLength(ProjectLimits.ExplorerNameMaxLength);
        builder.Property(p => p.AtlasDate).HasMaxLength(ProjectLimits.AtlasDateMaxLength);
        builder.Property(p => p.CreatedAt).IsRequired();
        builder.Property(p => p.UpdatedAt).IsRequired();
        // Saved worksheet legs as one jsonb array of {From, To}. Explicit conversion and
        // comparer, so EF notices a changed list and nothing depends on provider POCO mapping.
        builder.Property(p => p.WorksheetLegs)
            .HasColumnType("jsonb")
            .HasConversion(
                v => System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                v => System.Text.Json.JsonSerializer.Deserialize<List<WorksheetLegRef>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new List<WorksheetLegRef>(),
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<List<WorksheetLegRef>>(
                    (a, b) => (a ?? new List<WorksheetLegRef>()).SequenceEqual(b ?? new List<WorksheetLegRef>()),
                    v => v.Aggregate(0, (h, l) => HashCode.Combine(h, l.GetHashCode())),
                    v => v.ToList()))
            .HasDefaultValueSql("'[]'::jsonb")
            .IsRequired();
        // Saved editor render choices; existing rows get MapTier null ("not chosen") and both
        // switches off (the migration's column default), which is what the editor showed.
        builder.ToTable(t => t.HasCheckConstraint("CK_Projects_MapTier", "\"MapTier\" IS NULL OR \"MapTier\" BETWEEN 1 AND 4"));

        builder.HasOne(p => p.Extent)
            .WithOne(e => e.Project!)
            .HasForeignKey<AtlasExtent>(e => e.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(p => p.PageGrid)
            .WithOne(g => g.Project!)
            .HasForeignKey<AtlasPageGrid>(g => g.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(p => p.Locations)
            .WithOne(l => l.Project!)
            .HasForeignKey(l => l.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(p => p.GeneratedPdfs)
            .WithOne(g => g.Project!)
            .HasForeignKey(g => g.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class AtlasExtentConfiguration : IEntityTypeConfiguration<AtlasExtent>
{
    public void Configure(EntityTypeBuilder<AtlasExtent> builder)
    {
        builder.Property(e => e.Bounds)
            .HasColumnType("geometry(Polygon, 4326)")
            .IsRequired();

        builder.HasIndex(e => e.ProjectId).IsUnique();
    }
}

public class AtlasPageGridConfiguration : IEntityTypeConfiguration<AtlasPageGrid>
{
    public void Configure(EntityTypeBuilder<AtlasPageGrid> builder)
    {
        builder.Property(g => g.Orientation)
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(g => g.ScalePresetId).IsRequired().HasMaxLength(32);

        builder.HasOne(g => g.ScalePreset)
            .WithMany()
            .HasForeignKey(g => g.ScalePresetId)
            .OnDelete(DeleteBehavior.Restrict);

        // Owned safe margins -> Margins_Top, Margins_Right, ... columns.
        builder.OwnsOne(g => g.Margins);

        builder.HasIndex(g => g.ProjectId).IsUnique();
    }
}

public class AtlasPageConfiguration : IEntityTypeConfiguration<AtlasPage>
{
    public void Configure(EntityTypeBuilder<AtlasPage> builder)
    {
        builder.Property(p => p.Label).IsRequired().HasMaxLength(8);

        builder.Property(p => p.Bounds)
            .HasColumnType("geometry(Polygon, 4326)")
            .IsRequired();

        builder.HasOne(p => p.PageGrid)
            .WithMany(g => g.Pages)
            .HasForeignKey(p => p.PageGridId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(p => new { p.PageGridId, p.Label }).IsUnique();
    }
}

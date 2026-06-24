using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace JourneyBook.Infrastructure.Persistence.Configurations;

public class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.Property(p => p.Name).IsRequired().HasMaxLength(200);
        builder.Property(p => p.CreatedAt).IsRequired();
        builder.Property(p => p.UpdatedAt).IsRequired();

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

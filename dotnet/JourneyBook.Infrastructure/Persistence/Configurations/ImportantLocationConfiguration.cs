using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace JourneyBook.Infrastructure.Persistence.Configurations;

public class ImportantLocationConfiguration : IEntityTypeConfiguration<ImportantLocation>
{
    public void Configure(EntityTypeBuilder<ImportantLocation> builder)
    {
        builder.Property(l => l.Name).IsRequired().HasMaxLength(200);

        builder.Property(l => l.Location)
            .HasColumnType("geometry(Point, 4326)")
            .IsRequired();

        builder.Property(l => l.Category)
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(l => l.SourceConfidence)
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(l => l.Notes).HasMaxLength(2000);
        builder.Property(l => l.GeocodedFrom).HasMaxLength(500);
        builder.Property(l => l.GeocodeProvider).HasMaxLength(50);

        builder.HasIndex(l => l.ProjectId);
        builder.HasIndex(l => new { l.ProjectId, l.LocationNumber }).IsUnique();
    }
}

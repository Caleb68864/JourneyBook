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
        // Optional per-location scale override; matches the ScalePresets PK width.
        builder.Property(l => l.ScalePresetId).HasMaxLength(32);
        // Zoom ladder: an ordered list of scale preset ids -> Postgres text[].
        // Order is meaningful (coarse -> fine), so this stays an array rather than
        // a join table; the ids are validated against ScalePresets on write.
        builder.Property(l => l.ZoomLevels).HasColumnType("text[]");
        // Custom pin: shape id + hex color.
        builder.Property(l => l.PinShape).HasMaxLength(20);
        builder.Property(l => l.PinColor).HasMaxLength(9);

        builder.HasIndex(l => l.ProjectId);
        builder.HasIndex(l => new { l.ProjectId, l.LocationNumber }).IsUnique();
    }
}

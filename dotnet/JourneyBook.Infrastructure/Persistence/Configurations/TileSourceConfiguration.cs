using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace JourneyBook.Infrastructure.Persistence.Configurations;

public class TileSourceConfiguration : IEntityTypeConfiguration<TileSource>
{
    public void Configure(EntityTypeBuilder<TileSource> builder)
    {
        builder.Property(t => t.Key).IsRequired().HasMaxLength(64);
        builder.HasIndex(t => t.Key).IsUnique();

        builder.Property(t => t.Provider).IsRequired().HasMaxLength(120);
        builder.Property(t => t.SourceUrl).IsRequired().HasMaxLength(1000);
        builder.Property(t => t.Version).HasMaxLength(60);
        builder.Property(t => t.Attribution).IsRequired().HasMaxLength(500);

        // Owned cache/terms policy -> Cache_MaxAgeSeconds, Cache_OfflineAllowed.
        builder.OwnsOne(t => t.Cache);
    }
}

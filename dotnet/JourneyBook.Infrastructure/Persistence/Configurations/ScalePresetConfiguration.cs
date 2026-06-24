using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace JourneyBook.Infrastructure.Persistence.Configurations;

public class ScalePresetConfiguration : IEntityTypeConfiguration<ScalePreset>
{
    public void Configure(EntityTypeBuilder<ScalePreset> builder)
    {
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasMaxLength(32);
        builder.Property(s => s.Label).IsRequired().HasMaxLength(64);

        // Seed matches SCALE_PRESETS in @journeybook/atlas-core.
        builder.HasData(
            new ScalePreset { Id = "usgs-7-5-min", Label = "7.5-minute (1:24,000)", Ratio = 24000 },
            new ScalePreset { Id = "1-25000", Label = "1:25,000", Ratio = 25000 },
            new ScalePreset { Id = "usgs-15-min", Label = "15-minute (1:62,500)", Ratio = 62500 },
            new ScalePreset { Id = "1-50000", Label = "1:50,000", Ratio = 50000 },
            new ScalePreset { Id = "1-100000", Label = "1:100,000", Ratio = 100000 });
    }
}

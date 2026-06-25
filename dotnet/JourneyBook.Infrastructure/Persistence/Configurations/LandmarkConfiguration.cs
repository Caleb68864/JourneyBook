using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace JourneyBook.Infrastructure.Persistence.Configurations;

public class LandmarkConfiguration : IEntityTypeConfiguration<Landmark>
{
    public void Configure(EntityTypeBuilder<Landmark> builder)
    {
        builder.Property(l => l.Name).IsRequired().HasMaxLength(300);

        builder.Property(l => l.Location)
            .HasColumnType("geometry(Point, 4326)")
            .IsRequired();

        builder.Property(l => l.Category)
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(l => l.Score);

        builder.Property(l => l.SourceTags)
            .HasColumnType("jsonb");

        builder.HasIndex(l => l.ProjectId);
    }
}

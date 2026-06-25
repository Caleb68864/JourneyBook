using System.Text.Json;
using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

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

        // Persist SourceTags as a JSON string in a jsonb column. A value converter
        // (Dictionary <-> JSON text) is required because the data source does not
        // call EnableDynamicJson — without it Npgsql throws at SaveChanges when
        // serializing an arbitrary Dictionary<string,string> to jsonb.
        var tagsConverter = new ValueConverter<Dictionary<string, string>, string>(
            v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
            v => JsonSerializer.Deserialize<Dictionary<string, string>>(v, (JsonSerializerOptions?)null)
                 ?? new Dictionary<string, string>());

        // Mutable reference type needs a comparer so EF tracks content changes.
        var tagsComparer = new ValueComparer<Dictionary<string, string>>(
            (a, b) => JsonSerializer.Serialize(a, (JsonSerializerOptions?)null)
                      == JsonSerializer.Serialize(b, (JsonSerializerOptions?)null),
            v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null).GetHashCode(),
            v => JsonSerializer.Deserialize<Dictionary<string, string>>(
                     JsonSerializer.Serialize(v, (JsonSerializerOptions?)null), (JsonSerializerOptions?)null)
                 ?? new Dictionary<string, string>());

        builder.Property(l => l.SourceTags)
            .HasColumnType("jsonb")
            .HasConversion(tagsConverter, tagsComparer);

        builder.HasIndex(l => l.ProjectId);
    }
}

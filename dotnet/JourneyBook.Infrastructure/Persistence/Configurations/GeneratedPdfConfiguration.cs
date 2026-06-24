using JourneyBook.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace JourneyBook.Infrastructure.Persistence.Configurations;

public class GeneratedPdfConfiguration : IEntityTypeConfiguration<GeneratedPdf>
{
    public void Configure(EntityTypeBuilder<GeneratedPdf> builder)
    {
        builder.Property(g => g.Status)
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(g => g.FilePath).HasMaxLength(1000);
        builder.Property(g => g.CreatedAt).IsRequired();

        builder.Property(g => g.SourceMetadataSnapshot).HasColumnType("jsonb");

        builder.HasIndex(g => g.ProjectId);
    }
}

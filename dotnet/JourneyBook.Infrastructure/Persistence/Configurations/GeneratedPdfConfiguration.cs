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

        builder.Property(g => g.ExpiresAt);

        // Bounded so an exception message with a stack-trace-sized payload cannot
        // become an unbounded column; the runner truncates before it gets here.
        builder.Property(g => g.ErrorMessage).HasMaxLength(2000);

        builder.HasIndex(g => g.ProjectId);
    }
}

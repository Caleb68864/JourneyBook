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

        // The engine's own phase word, not a status of ours. Bounded because it is
        // a free string from another process: the longest member of the engine's
        // union is "overview" (8), so 32 leaves room for a new one without leaving
        // room for a payload.
        builder.Property(g => g.Phase).HasMaxLength(32);

        builder.HasIndex(g => g.ProjectId);
    }
}

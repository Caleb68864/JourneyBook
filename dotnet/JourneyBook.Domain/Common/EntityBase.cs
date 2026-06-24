namespace JourneyBook.Domain.Common;

/// <summary>
/// Base type for domain entities. Stage 0 bones — a single identity key.
/// Concrete entities (Project, ImportantLocation, AtlasExtent, TileSource,
/// GeneratedPdf …) arrive in Stage 2A.
/// </summary>
public abstract class EntityBase
{
    public Guid Id { get; set; }
}

namespace JourneyBook.Domain.ValueObjects;

/// <summary>
/// Printable safe margins in inches, with an optional binder gutter on the
/// binding edge. Owned by <see cref="Entities.AtlasPageGrid"/>.
/// </summary>
public class PageMargins
{
    public double Top { get; set; } = 0.5;
    public double Right { get; set; } = 0.5;
    public double Bottom { get; set; } = 0.5;
    public double Left { get; set; } = 0.5;

    /// <summary>Extra inches added to the binding edge for hole-punch/binder.</summary>
    public double Gutter { get; set; }
}

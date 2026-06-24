namespace JourneyBook.Domain.Entities;

/// <summary>
/// A named map-scale preset (reference data). Choosing a scale fixes the ground
/// footprint of every page. Seeded to match <c>SCALE_PRESETS</c> in
/// <c>@journeybook/atlas-core</c>. Uses a stable string key, so it does not
/// derive from <see cref="Common.EntityBase"/>.
/// </summary>
public class ScalePreset
{
    /// <summary>Stable id, e.g. "usgs-7-5-min".</summary>
    public required string Id { get; set; }

    /// <summary>Human label, e.g. "7.5-minute (1:24,000)".</summary>
    public required string Label { get; set; }

    /// <summary>Scale denominator: 1 : Ratio (e.g. 24000).</summary>
    public int Ratio { get; set; }
}

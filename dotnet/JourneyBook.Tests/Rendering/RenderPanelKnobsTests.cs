using JourneyBook.Application.Rendering;

namespace JourneyBook.Tests.Rendering;

/// <summary>
/// The API's bounds check on the basemap panel knobs must agree, exactly, with
/// the engine's (<c>packages/render-cli/src/render.ts validateInput</c>) and the
/// worker's JSON schema (<c>renderBodySchema</c>).
/// </summary>
/// <remarks>
/// Both directions matter and only mean something together. The refusals stop a
/// bad value becoming a queued job that fails minutes later; the ACCEPTANCE cases
/// are the control, because a guard that is one notch tighter than the engine
/// refuses renders the engine would have produced, and every negative test stays
/// green while it does so.
/// </remarks>
public class RenderPanelKnobsTests
{
    private static RenderProjectRequest Req(
        int? widthPx = null, string? format = null, int? quality = null) =>
        new(PanelWidthPx: widthPx, PanelFormat: format, PanelQuality: quality);

    [Fact]
    public void An_unset_knob_is_valid()
    {
        Assert.Null(RenderPanelKnobs.Validate(new RenderProjectRequest()));
    }

    /// <summary>
    /// [CONTROL] Every value the engine accepts, this must accept — including the
    /// exact endpoints of each range, which is where an off-by-one guard shows up.
    /// </summary>
    [Theory]
    [InlineData(256, null, null)]     // engine floor
    [InlineData(8000, null, null)]    // engine ceiling
    [InlineData(1000, null, null)]    // DEFAULT_PANEL_WIDTH_PX
    [InlineData(1730, null, null)]    // PRINT_TARGET_PANEL_WIDTH_PX
    [InlineData(null, "jpeg", null)]
    [InlineData(null, "png", null)]
    [InlineData(null, "JPEG", null)]  // lower-cased downstream, so valid here
    [InlineData(null, "PNG", null)]
    [InlineData(null, null, 1)]
    [InlineData(null, null, 100)]
    [InlineData(null, null, 90)]      // the engine default
    [InlineData(2048, "png", 55)]
    public void Accepts_everything_the_engine_accepts(int? widthPx, string? format, int? quality)
    {
        var error = RenderPanelKnobs.Validate(Req(widthPx, format, quality));
        Assert.True(error is null, $"refused a value the engine renders: {error}");
    }

    [Theory]
    [InlineData(255)]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(8001)]
    [InlineData(40000)]
    public void Refuses_a_panel_width_outside_the_engines_range(int widthPx)
    {
        Assert.Contains("PanelWidthPx", RenderPanelKnobs.Validate(Req(widthPx: widthPx)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(101)]
    [InlineData(-5)]
    public void Refuses_a_quality_outside_1_to_100(int quality)
    {
        Assert.Contains("PanelQuality", RenderPanelKnobs.Validate(Req(quality: quality)));
    }

    [Theory]
    [InlineData("webp")]
    [InlineData("tiff")]
    [InlineData("")]
    [InlineData("jpg")] // sharp's name for it; the engine's union says "jpeg"
    public void Refuses_a_format_the_engines_union_does_not_name(string format)
    {
        Assert.Contains("PanelFormat", RenderPanelKnobs.Validate(Req(format: format)));
    }

    /// <summary>The message names the offending value, so a 400 is actionable.</summary>
    [Fact]
    public void The_message_names_the_value_that_was_refused()
    {
        Assert.Contains("9000", RenderPanelKnobs.Validate(Req(widthPx: 9000)));
        Assert.Contains("webp", RenderPanelKnobs.Validate(Req(format: "webp")));
        Assert.Contains("120", RenderPanelKnobs.Validate(Req(quality: 120)));
    }
}

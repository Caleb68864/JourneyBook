namespace JourneyBook.Application.Rendering;

/// <summary>
/// Bounds checks for the basemap panel knobs on <see cref="RenderProjectRequest"/>.
/// </summary>
/// <remarks>
/// <para>
/// These mirror <c>packages/render-cli/src/render.ts validateInput</c> and the
/// worker's <c>renderBodySchema</c> <b>exactly</b> — 256–8000 px, quality 1–100,
/// format jpeg|png. Deliberately not stricter: the engine, the worker schema and
/// this check are three components that must agree on what a valid request is,
/// and the failure mode of disagreement is that whichever one is tightest refuses
/// a request the other two would have rendered.
/// </para>
/// <para>
/// It lives here, next to the DTO it validates, rather than inside
/// <c>RenderService</c>, for one reason: <c>RenderService</c> takes a
/// <c>JourneyBookDbContext</c>, so anything inside it is reachable only through a
/// Testcontainers PostGIS run. A bounds check needs no database, and a check that
/// only runs in the Docker job is a check most contributors never see fail.
/// </para>
/// <para>
/// Null return means "nothing wrong". The format comparison is case-insensitive
/// because <c>HttpRenderWorkerClient.ToWirePanelFormat</c> lower-cases the value
/// for the engine's <c>"jpeg" | "png"</c> union — refusing "JPEG" here would
/// refuse a value the very next layer is about to make valid.
/// </para>
/// </remarks>
public static class RenderPanelKnobs
{
    /// <summary>Lowest panel width the engine accepts (<c>render.ts</c>).</summary>
    public const int MinPanelWidthPx = 256;

    /// <summary>Highest panel width the engine accepts (<c>render.ts</c>).</summary>
    public const int MaxPanelWidthPx = 8000;

    /// <summary>
    /// The first thing wrong with <paramref name="request"/>'s panel knobs, as a
    /// message fit for a 400 body, or <see langword="null"/> when all are valid
    /// (including all unset).
    /// </summary>
    public static string? Validate(RenderProjectRequest request)
    {
        if (request.PanelWidthPx is { } px && (px < MinPanelWidthPx || px > MaxPanelWidthPx))
            return $"PanelWidthPx must be {MinPanelWidthPx}–{MaxPanelWidthPx}, got {px}.";

        if (request.PanelQuality is { } q && (q < 1 || q > 100))
            return $"PanelQuality must be 1–100, got {q}.";

        if (request.PanelFormat is { } f
            && !string.Equals(f, "jpeg", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(f, "png", StringComparison.OrdinalIgnoreCase))
            return $"PanelFormat must be \"jpeg\" or \"png\", got \"{f}\".";

        return null;
    }
}

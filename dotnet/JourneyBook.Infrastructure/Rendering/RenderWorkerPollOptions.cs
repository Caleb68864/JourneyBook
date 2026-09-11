namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// How often <see cref="HttpRenderWorkerClient"/> asks the worker where a job has
/// got to.
/// </summary>
/// <param name="Interval">
/// Time between polls. One second by default — the same cadence the web client
/// polls the API with, so a page's progress bar cannot be held back by a coarser
/// server-side interval behind it, and cheap enough that a 200-page atlas costs a
/// few hundred status reads against minutes of tile fetching.
/// </param>
/// <remarks>
/// A type rather than a raw <c>TimeSpan</c> so tests can drive the loop at a
/// millisecond cadence without a one-second-per-poll test suite, and so the number
/// has somewhere to be documented.
/// </remarks>
public record RenderWorkerPollOptions(TimeSpan Interval)
{
    public RenderWorkerPollOptions() : this(TimeSpan.FromSeconds(1)) { }
}

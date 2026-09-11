using System.Collections.Concurrent;
using JourneyBook.Application.Rendering;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// One <see cref="CancellationTokenSource"/> per accepted render, held for the life
/// of the job.
/// </summary>
/// <remarks>
/// <para>
/// A singleton, because the three parties involved live in three different scopes:
/// the HTTP request that accepts the render registers the token, the background
/// runner links it into the render, and a later HTTP request cancels it. Nothing
/// scoped can be shared across all three.
/// </para>
/// <para>
/// Registration happens at ACCEPT, not at start, so the window in which a render is
/// cancellable has no hole in it. A job can sit in the queue behind another for
/// minutes; a registry populated when the runner picks it up would answer "not
/// running here" for exactly the period a user is most likely to change their mind.
/// </para>
/// </remarks>
public sealed class RenderCancellationRegistry : IRenderCancellationRegistry
{
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _sources = new();

    public CancellationToken Register(Guid generatedPdfId) =>
        _sources.GetOrAdd(generatedPdfId, _ => new CancellationTokenSource()).Token;

    public CancellationToken TokenFor(Guid generatedPdfId) =>
        _sources.TryGetValue(generatedPdfId, out var cts) ? cts.Token : CancellationToken.None;

    public bool Cancel(Guid generatedPdfId)
    {
        if (!_sources.TryGetValue(generatedPdfId, out var cts)) return false;
        cts.Cancel();
        return true;
    }

    /// <summary>Drop a finished render's token.</summary>
    /// <remarks>
    /// Removed but deliberately NOT disposed. The runner holds a linked token source
    /// built from this one for the life of the render, and disposing a source that
    /// still has live linked registrations is the kind of ordering hazard that
    /// surfaces as an <c>ObjectDisposedException</c> from inside an unrelated
    /// <c>await</c>. A <c>CancellationTokenSource</c> with no timer holds nothing
    /// the GC cannot reclaim, so the cost of not disposing is nil and the cost of
    /// getting the order wrong is a render that fails for a reason nobody can read.
    /// </remarks>
    public void Release(Guid generatedPdfId) => _sources.TryRemove(generatedPdfId, out _);
}

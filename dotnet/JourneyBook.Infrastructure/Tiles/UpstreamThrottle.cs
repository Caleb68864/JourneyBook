using System.Net;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// What a tile upstream says when it is busy: 429 or 503, and how long to wait. Shared by the
/// raster fetcher and the PMTiles range reader so both pass a throttle on the same way
/// (<see cref="FetchedTile.Throttled"/> → the proxy answers the status with <c>Retry-After</c>).
/// </summary>
public static class UpstreamThrottle
{
    public static bool IsThrottle(HttpStatusCode status) =>
        status is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable;

    /// <summary>
    /// The response's <c>Retry-After</c> as a delay: delay-seconds as given, an HTTP-date as the
    /// time left until it (a past date is zero). Null when the header is absent.
    /// </summary>
    public static TimeSpan? RetryAfterOf(HttpResponseMessage res, DateTimeOffset now)
    {
        var header = res.Headers.RetryAfter;
        if (header?.Delta is { } delta)
        {
            return delta;
        }

        if (header?.Date is { } date)
        {
            var left = date - now;
            return left > TimeSpan.Zero ? left : TimeSpan.Zero;
        }

        return null;
    }
}

/// <summary>
/// Thrown by <see cref="HttpRangeStream"/> when the archive's host throttles a range request, so
/// <see cref="PmTilesFetcher"/> can tell "busy, retry later" from a broken or missing archive.
/// </summary>
public sealed class UpstreamThrottledException(int status, TimeSpan? retryAfter)
    : IOException($"Range request throttled: {status}")
{
    public int Status { get; } = status;
    public TimeSpan? RetryAfter { get; } = retryAfter;
}

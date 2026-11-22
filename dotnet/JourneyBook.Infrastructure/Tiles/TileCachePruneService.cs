using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// The tile cache's limits and how often they are applied: a size cap
/// (<c>TileCache:MaxSizeMb</c>) and an age limit (<c>TileCache:MaxAgeDays</c>). Zero or less
/// means that limit is off, and both are off by default (Stage 7, decided by agent
/// 2026-11-21: a deleted tile costs a re-fetch from USGS, so nothing is deleted until an
/// operator picks a number). Either one on enables the sweep.
/// </summary>
public sealed record TileCachePruneOptions(long MaxBytes, TimeSpan Interval, TimeSpan MaxAge = default)
{
    public bool Enabled => (MaxBytes > 0 || MaxAge > TimeSpan.Zero) && Interval > TimeSpan.Zero;
}

/// <summary>Applies the tile cache's size cap and age limit at startup and then once per interval.</summary>
public sealed class TileCachePruneService(
    TileCache cache,
    TileCachePruneOptions options,
    ILogger<TileCachePruneService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            logger.LogInformation("Tile cache pruning is disabled (neither TileCache:MaxSizeMb nor TileCache:MaxAgeDays is set).");
            return;
        }

        using var timer = new PeriodicTimer(options.Interval);
        try
        {
            do
            {
                PruneOnce();
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown; nothing to say.
        }
    }

    private void PruneOnce()
    {
        try
        {
            var result = cache.Prune(
                options.MaxBytes > 0 ? options.MaxBytes : null,
                maxAge: options.MaxAge > TimeSpan.Zero ? options.MaxAge : null);
            if (result.RemovedTiles > 0 || result.RemovedTempFiles > 0)
            {
                logger.LogInformation(
                    "Tile cache prune removed {Tiles} tile(s) and {TempFiles} temp file(s); {Bytes} bytes remain.",
                    result.RemovedTiles,
                    result.RemovedTempFiles,
                    result.BytesRemaining);
            }
        }
        catch (Exception ex)
        {
            // Deliberately broad: an exception escaping a BackgroundService stops the host,
            // and a cache housekeeping failure must not take the API down.
            logger.LogError(ex, "Tile cache prune failed; will retry next interval.");
        }
    }
}

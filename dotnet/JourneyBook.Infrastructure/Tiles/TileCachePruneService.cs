using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Tiles;

/// <summary>
/// The tile cache's size limit and how often it is applied. A limit of zero or less
/// disables pruning, which is the default: how long tiles should be kept is an open
/// question in <c>vault/staged-build-roadmap.md</c>, and a deleted tile costs a re-fetch.
/// </summary>
public sealed record TileCachePruneOptions(long MaxBytes, TimeSpan Interval)
{
    public bool Enabled => MaxBytes > 0 && Interval > TimeSpan.Zero;
}

/// <summary>Applies <c>TileCache:MaxSizeMb</c> at startup and then once per interval.</summary>
public sealed class TileCachePruneService(
    TileCache cache,
    TileCachePruneOptions options,
    ILogger<TileCachePruneService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            logger.LogInformation("Tile cache pruning is disabled (TileCache:MaxSizeMb is not set).");
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
            var result = cache.Prune(options.MaxBytes);
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

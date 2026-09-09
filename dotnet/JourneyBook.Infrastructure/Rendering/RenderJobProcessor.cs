using JourneyBook.Application.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// Drains <see cref="IRenderJobQueue"/> and runs each job through
/// <see cref="IRenderJobRunner"/> in its own DI scope.
/// </summary>
/// <remarks>
/// <para>
/// Own scope per job because the runner reaches <c>IGeneratedPdfService</c>, which
/// holds a scoped <c>DbContext</c>: the request scope that accepted the render is
/// disposed the moment the 202 is written, so the background work cannot borrow it.
/// </para>
/// <para>
/// Strictly one job at a time. Rendering a 60-page atlas is 60 sequential basemap
/// fetches through the tile proxy; running several at once would multiply that load
/// against USGS for no gain in wall-clock time for the user actually waiting. When
/// concurrency is wanted it belongs on the worker side, alongside the progress
/// reporting, not here.
/// </para>
/// </remarks>
public sealed class RenderJobProcessor(
    IRenderJobQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<RenderJobProcessor> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var job in queue.DequeueAllAsync(stoppingToken))
            {
                using var scope = scopeFactory.CreateScope();
                var runner = scope.ServiceProvider.GetRequiredService<IRenderJobRunner>();

                // RunAsync marks the record Failed on any throw, so a job that blows up
                // must not also take the loop down with it and strand every job behind
                // it at Pending for ever. This catch is the belt to that braces.
                try
                {
                    await runner.RunAsync(job, stoppingToken);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex,
                        "Render job {GeneratedPdfId} threw out of the runner; continuing the queue.",
                        job.GeneratedPdfId);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
    }
}

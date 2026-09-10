using JourneyBook.Application.GeneratedPdfs;
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
    /// <summary>
    /// What a row stranded by a crash is told, once this host has established that it
    /// cannot possibly still be rendering.
    /// </summary>
    public const string StrandedByRestartMessage =
        "The service restarted while this render was queued or in progress, and the queue " +
        "does not survive a restart. Generate the atlas again.";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Startup reconciliation, BEFORE the first job is dequeued.
        //
        // FailQueuedJobsAsync below closes the orderly-SIGTERM case and nothing else.
        // After a SIGKILL, an OOM kill, a container crash or power loss there is no
        // shutdown path at all, and retention does not help: PruneExpiredAsync only
        // removes rows past their 30-day ExpiresAt, and a row stranded ten seconds ago
        // by a crash is not expired. Such a row sat at Pending for the full retention
        // window while the client polled it 900 times and then reported that the render
        // was still running.
        //
        // The queue is in-process (a Channel in this host, ADR 0005), so at the instant
        // this host starts, nothing is rendering: a Pending or Rendering row is
        // previous-process wreckage by definition. See IGeneratedPdfService.
        // FailStrandedAsync for why a second API instance would invalidate that.
        await FailStrandedOnStartupAsync(stoppingToken);

        // A job taken off the queue after shutdown began and therefore never started.
        // `ChannelReader.ReadAllAsync` keeps yielding whatever is already BUFFERED
        // once it has decided there is something to read — it does not re-check the
        // token between buffered items — so without the guard below the loop happily
        // "runs" every queued job against an already-cancelled token on the way out.
        RenderJob? notStarted = null;

        try
        {
            await foreach (var job in queue.DequeueAllAsync(stoppingToken))
            {
                if (stoppingToken.IsCancellationRequested)
                {
                    notStarted = job;
                    break;
                }

                using var scope = scopeFactory.CreateScope();
                var runner = scope.ServiceProvider.GetRequiredService<IRenderJobRunner>();

                // RunAsync marks the record Failed on any throw, so a job that blows up
                // must not also take the loop down with it and strand every job behind
                // it at Pending for ever. This catch is the belt to that braces.
                try
                {
                    await runner.RunAsync(job, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    // Shutdown mid-render. RunAsync has already marked this record
                    // Failed on an uncancelled token; everything behind it is drained
                    // below. Do not keep looping — there is nothing left to run.
                    break;
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

        // Whatever is still queued dies with this process — the channel is in-process
        // and nothing resumes a job from it. ADR 0006 says "a cancelled or shut-down
        // render is marked Failed"; that used to be true of at most one row per
        // shutdown (the one in flight), and every job still in the channel was
        // discarded in silence, leaving its record at Pending for ever while the
        // client polled it 900 times and then told the user it was still running.
        await FailQueuedJobsAsync(notStarted);
    }

    private async Task FailStrandedOnStartupAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var pdfService = scope.ServiceProvider.GetRequiredService<IGeneratedPdfService>();

            var failed = await pdfService.FailStrandedAsync(StrandedByRestartMessage, ct);
            if (failed > 0)
            {
                logger.LogWarning(
                    "Startup found {Count} render record(s) left at Pending/Rendering by a previous " +
                    "process; marked Failed.",
                    failed);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Stopped before we got going; nothing to say.
        }
        catch (Exception ex)
        {
            // Deliberately swallowed. Reconciliation is a courtesy to rows from a
            // previous process; a database that is not ready yet must not stop this
            // host from serving the renders it is being started to serve.
            logger.LogError(ex, "Could not reconcile stranded render records at startup.");
        }
    }

    private async Task FailQueuedJobsAsync(RenderJob? notStarted)
    {
        List<RenderJob> stranded = notStarted is null ? [] : [notStarted];
        try
        {
            stranded.AddRange(queue.DrainPending());
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not drain the render queue during shutdown.");
        }

        if (stranded.Count == 0) return;

        logger.LogWarning(
            "Host is stopping with {Count} render job(s) still queued; marking them Failed.",
            stranded.Count);

        // A fresh scope, and CancellationToken.None: the stopping token is already
        // cancelled, so using it here would fail the very writes that exist to record
        // the shutdown. The host's ShutdownTimeout bounds how long this may take.
        using var scope = scopeFactory.CreateScope();
        var pdfService = scope.ServiceProvider.GetRequiredService<IGeneratedPdfService>();

        foreach (var job in stranded)
        {
            try
            {
                await pdfService.UpdateStatusAsync(
                    job.GeneratedPdfId,
                    new UpdateGeneratedPdfStatusRequest(
                        "Failed",
                        null,
                        "The service shut down before this render started, and the queue does not " +
                        "survive a restart. Generate the atlas again."),
                    CancellationToken.None);
            }
            catch (Exception ex)
            {
                // One unwritable row must not strand the rest.
                logger.LogError(ex,
                    "Could not mark queued render {GeneratedPdfId} Failed during shutdown.",
                    job.GeneratedPdfId);
            }
        }
    }
}

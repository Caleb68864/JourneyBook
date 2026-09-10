using JourneyBook.Application.GeneratedPdfs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.GeneratedPdfs;

/// <summary>
/// How often expired generated-PDF records are swept. Zero or negative disables the
/// sweep entirely (the manual <c>POST /api/generated-pdfs/prune</c> still works).
/// </summary>
public sealed record GeneratedPdfRetentionOptions(TimeSpan Interval)
{
    public bool Enabled => Interval > TimeSpan.Zero;
}

/// <summary>
/// Applies <c>GeneratedPdf:RetentionDays</c> — periodically, without anyone asking.
/// </summary>
/// <remarks>
/// <para>
/// <c>PruneExpiredAsync</c> used to have exactly one caller: the manual
/// <c>POST /api/generated-pdfs/prune</c> endpoint. There was no hosted service, no
/// scheduled job, no compose entry and no UI call anywhere in the repo, so
/// <c>RetentionDays</c> stamped an <c>ExpiresAt</c> on every record that nothing ever
/// read. Expired rows and their PDFs on the shared volume accumulated for ever.
/// </para>
/// <para>
/// This matters beyond disk. ADR 0006 accepts a lifecycle row stranded by a restart on
/// the grounds that it is "stranded for its whole retention window" — language that
/// only makes sense if something eventually clears it. Nothing did.
/// </para>
/// <para>
/// One sweep at startup (which is when a restart's wreckage is on the floor), then one
/// per interval. A failed sweep is logged and retried next time: a transient DB blip
/// must not retire retention for the life of the process.
/// </para>
/// </remarks>
public sealed class GeneratedPdfRetentionService(
    IServiceScopeFactory scopeFactory,
    GeneratedPdfRetentionOptions options,
    ILogger<GeneratedPdfRetentionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            logger.LogInformation(
                "Generated-PDF retention sweep is disabled (GeneratedPdf:PruneIntervalHours <= 0).");
            return;
        }

        using var timer = new PeriodicTimer(options.Interval);

        do
        {
            await PruneOnceAsync(stoppingToken);
        }
        while (await SafeWaitAsync(timer, stoppingToken));
    }

    private async Task PruneOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var pdfs = scope.ServiceProvider.GetRequiredService<IGeneratedPdfService>();

            var removed = await pdfs.PruneExpiredAsync(ct);
            if (removed > 0)
            {
                logger.LogInformation("Retention sweep removed {Count} expired generated-PDF record(s).", removed);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutdown during a sweep; nothing to say.
        }
        catch (Exception ex)
        {
            // Deliberately swallowed: the next sweep retries. A prune that throws
            // once must not be the reason retention stops for ever.
            logger.LogError(ex, "Generated-PDF retention sweep failed; will retry next interval.");
        }
    }

    private static async Task<bool> SafeWaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}

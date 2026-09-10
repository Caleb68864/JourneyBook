using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// Performs one queued render and drives the lifecycle record through it:
/// <c>Pending → Rendering → Completed | Failed</c>.
/// </summary>
/// <remarks>
/// <para>
/// <c>Rendering</c> is the state the enum has always declared and nothing has ever
/// written. It exists so a polling client can tell "queued behind other work" from
/// "the worker has the job", which is the difference between a progress bar that can
/// honestly start and one that cannot.
/// </para>
/// <para>
/// It is still the <em>API's</em> knowledge of the render, not the worker's: this
/// process knows only that it has an HTTP call outstanding, not that the worker is on
/// page 12 of 60. Page-level progress needs the worker to own the job and report it;
/// this class is the seam that will read it when it does.
/// </para>
/// </remarks>
public sealed class RenderJobRunner(
    IGeneratedPdfService pdfService,
    IRenderWorkerClient workerClient,
    ILogger<RenderJobRunner> logger) : IRenderJobRunner
{
    /// <summary>Longest error text persisted; matches the column's max length.</summary>
    private const int MaxErrorLength = 2000;

    public async Task RunAsync(RenderJob job, CancellationToken ct = default)
    {
        await pdfService.UpdateStatusAsync(
            job.GeneratedPdfId, new UpdateGeneratedPdfStatusRequest("Rendering"), ct);

        try
        {
            var result = await workerClient.RenderAsync(job.WorkerRequest, ct);

            await pdfService.UpdateStatusAsync(
                job.GeneratedPdfId,
                new UpdateGeneratedPdfStatusRequest("Completed", result.OutputPath),
                ct);
        }
        catch (Exception ex)
        {
            // Host shutdown mid-render is still a failed render from the record's
            // point of view — it left nothing on disk — so it is marked the same way,
            // with a token that is not itself cancelled. Leaving it at "Rendering"
            // would strand the row for ever, since nothing resumes an in-flight job.
            //
            // But only a cancellation the *caller* asked for is a cancellation. An
            // HttpClient deadline also arrives as an OperationCanceledException, and
            // reporting the API's own impatience as "the service shut down or the job
            // was aborted" told the user two things that were both untrue. The token
            // is the discriminator: uncancelled means the deadline was ours.
            // HttpRenderWorkerClient normally converts its own timeout to a
            // TimeoutException (with the number in it); this is the backstop for every
            // other timeout in the path.
            var message = ex switch
            {
                OperationCanceledException when ct.IsCancellationRequested =>
                    "Render was cancelled before it finished (the service shut down or the job was aborted).",
                OperationCanceledException =>
                    "Render timed out: the API stopped waiting for the render worker. " +
                    "See RenderWorker:TimeoutSeconds.",
                _ => ex.Message,
            };

            logger.LogError(ex,
                "Render worker failed for project {ProjectId} (pdf {GeneratedPdfId})",
                job.ProjectId, job.GeneratedPdfId);

            await pdfService.UpdateStatusAsync(
                job.GeneratedPdfId,
                new UpdateGeneratedPdfStatusRequest("Failed", null, Truncate(message)),
                CancellationToken.None);
        }
    }

    private static string Truncate(string value) =>
        value.Length <= MaxErrorLength ? value : value[..MaxErrorLength];
}

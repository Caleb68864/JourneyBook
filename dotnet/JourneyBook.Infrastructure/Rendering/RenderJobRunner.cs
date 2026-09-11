using JourneyBook.Application.GeneratedPdfs;
using JourneyBook.Application.Rendering;
using Microsoft.Extensions.Logging;

namespace JourneyBook.Infrastructure.Rendering;

/// <summary>
/// Performs one queued render and drives the lifecycle record through it:
/// <c>Pending → Rendering → Completed | Failed | Cancelled</c>.
/// </summary>
/// <remarks>
/// <para>
/// <c>Rendering</c> is the state the enum has always declared and nothing had ever
/// written. It exists so a polling client can tell "queued behind other work" from
/// "the worker has the job", which is the difference between a progress bar that can
/// honestly start and one that cannot.
/// </para>
/// <para>
/// Since ADR 0007 it is also the worker's knowledge, not an inference: the worker
/// owns the job and reports which page it is on, and this class writes that onto the
/// record through <see cref="IGeneratedPdfService.UpdateProgressAsync"/>. The
/// comment that used to sit here — "this class is the seam that will read it when it
/// does" — is now this method's progress handler.
/// </para>
/// <para>
/// Four ways a render can end and four different things to say about them. Getting
/// that wrong is this codebase's recurring failure: a worker timeout once arrived as
/// "the service shut down or the job was aborted", which was two untrue statements.
/// The discriminators are the two tokens — the user's and the host's — and the
/// exception type.
/// </para>
/// </remarks>
public sealed class RenderJobRunner(
    IGeneratedPdfService pdfService,
    IRenderWorkerClient workerClient,
    IRenderCancellationRegistry cancellations,
    ILogger<RenderJobRunner> logger) : IRenderJobRunner
{
    /// <summary>Longest error text persisted; matches the column's max length.</summary>
    private const int MaxErrorLength = 2000;

    public async Task RunAsync(RenderJob job, CancellationToken ct = default)
    {
        // The user's cancel channel, registered when the render was accepted. It is
        // CancellationToken.None when nothing registered one (a job built by a test,
        // or a queue drained after the registry entry was released), which links
        // harmlessly.
        var cancelToken = cancellations.TokenFor(job.GeneratedPdfId);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, cancelToken);

        try
        {
            // Cancelled while it was still in the queue. There is nothing to stop
            // and nothing to tell the worker; write the outcome and do not start a
            // render the user has already withdrawn. Without this the job would run
            // to completion or fail on the first poll, and either answer is a lie
            // about what happened.
            if (cancelToken.IsCancellationRequested)
            {
                await WriteAsync(job, "Cancelled", null,
                    "Render was cancelled before it started (it was still queued).");
                return;
            }

            // INSIDE the try. This write used to sit outside it, so a throw from it —
            // the row deleted between accept and dequeue, a DB blip — escaped RunAsync
            // uncaught, was swallowed by RenderJobProcessor's catch, and left the row
            // at Pending for ever. That is precisely the case the processor's "belt to
            // the braces" comment claims RunAsync covers.
            await pdfService.UpdateStatusAsync(
                job.GeneratedPdfId, new UpdateGeneratedPdfStatusRequest("Rendering"), linked.Token);

            var result = await workerClient.RenderAsync(
                job.WorkerRequest,
                async (update, progressCt) =>
                {
                    await pdfService.UpdateProgressAsync(
                        job.GeneratedPdfId,
                        // Phase included. It used to stop here: the engine reports
                        // it, the worker records it, HttpRenderWorkerClient parses
                        // it into RenderProgressUpdate.Phase — and this call had no
                        // member for it, so the only reader in the repo was a test.
                        new UpdateGeneratedPdfProgressRequest(update.Page, update.PageCount, update.Phase),
                        progressCt);
                },
                linked.Token);

            await pdfService.UpdateStatusAsync(
                job.GeneratedPdfId,
                new UpdateGeneratedPdfStatusRequest("Completed", result.OutputPath),
                // CancellationToken.None: a render that finished must be RECORDED as
                // finished even if the host began stopping in the meantime.
                // Otherwise a shutdown landing between the worker's answer and this
                // write loses a PDF that is sitting on disk.
                CancellationToken.None);
        }
        catch (Exception ex)
        {
            var (status, message) = Classify(ex, ct, cancelToken);

            if (status == "Cancelled")
            {
                logger.LogInformation(
                    "Render cancelled for project {ProjectId} (pdf {GeneratedPdfId})",
                    job.ProjectId, job.GeneratedPdfId);
            }
            else
            {
                logger.LogError(ex,
                    "Render worker failed for project {ProjectId} (pdf {GeneratedPdfId})",
                    job.ProjectId, job.GeneratedPdfId);
            }

            await WriteAsync(job, status, null, message);
        }
        finally
        {
            // The token has done its job. Left in place it is a handle on a render
            // that has finished, and a later cancel for a reused id would find it.
            cancellations.Release(job.GeneratedPdfId);
        }
    }

    /// <summary>
    /// Decide what actually happened, in the order that keeps the four causes apart.
    /// </summary>
    /// <remarks>
    /// The user's cancel is checked BEFORE host shutdown, because both cancel the
    /// same linked token and only one of them is something the user did. Host
    /// shutdown stays <c>Failed</c>: nobody asked for it, so the record's advice is
    /// "generate it again", not "you stopped it".
    /// </remarks>
    private static (string Status, string Message) Classify(
        Exception ex, CancellationToken hostToken, CancellationToken cancelToken) => ex switch
    {
        // The worker told us it stopped because it was asked to. Its own type, so an
        // HttpClient deadline — which also throws OperationCanceledException — cannot
        // be mistaken for it.
        RenderCancelledException rc => ("Cancelled", rc.Message),

        OperationCanceledException when cancelToken.IsCancellationRequested =>
            ("Cancelled", "Render was cancelled."),

        OperationCanceledException when hostToken.IsCancellationRequested =>
            ("Failed", "The service shut down while this render was in progress, and renders do not " +
                       "resume across a restart. Generate the atlas again."),

        // Neither token was cancelled, so the deadline was ours.
        // HttpRenderWorkerClient normally converts its own timeout to a
        // TimeoutException (with the number in it); this is the backstop for every
        // other timeout in the path.
        OperationCanceledException =>
            ("Failed", "Render timed out: the API stopped waiting for the render worker. " +
                       "See RenderWorker:TimeoutSeconds."),

        _ => ("Failed", ex.Message),
    };

    private Task WriteAsync(RenderJob job, string status, string? filePath, string message) =>
        pdfService.UpdateStatusAsync(
            job.GeneratedPdfId,
            new UpdateGeneratedPdfStatusRequest(status, filePath, Truncate(message)),
            // Never the job's own token: it is normally already cancelled by the time
            // this runs, and writing the outcome on it would cancel the record of why.
            CancellationToken.None);

    private static string Truncate(string value) =>
        value.Length <= MaxErrorLength ? value : value[..MaxErrorLength];
}

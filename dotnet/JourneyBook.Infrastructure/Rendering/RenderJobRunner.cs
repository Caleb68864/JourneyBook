using System.Text.Json;
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
                new UpdateGeneratedPdfStatusRequest(
                    "Completed",
                    result.OutputPath,
                    SourceMetadataSnapshot: ProvenanceOf(job, result),
                    PageCount: result.PageCount),
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

    /// <summary>
    /// What this render was made from, as the <c>jsonb</c> snapshot the record has
    /// always declared and never been given.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>GeneratedPdf</c>'s own summary is "a record of a generated atlas PDF,
    /// with a snapshot of the source metadata (tile sources, attribution, scale)
    /// captured at render time", and <c>RenderService</c> created every record with
    /// <c>new CreateGeneratedPdfRequest()</c> — an empty one. The field's only
    /// writer was the manual create endpoint and its own test, so no record a real
    /// render produced ever carried the thing the record exists to carry.
    /// </para>
    /// <para>
    /// <c>Attribution</c> is the reason this is written HERE rather than at create
    /// time, and the reason it is worth writing at all. It is the credit the PDF
    /// actually printed — collected by the engine from the tiles that came back,
    /// not inferred from the request — and with a tile proxy it can name a source
    /// this process did not know about when the render was accepted. It arrived on
    /// <c>RenderWorkerResult</c>, was assigned into that record at
    /// <c>HttpRenderWorkerClient</c>, and had **no reader anywhere in the repo**.
    /// `vault/licensing-and-attribution/required-attribution-text.md` asks for
    /// source-specific credit; the footer makes it visible, this makes it
    /// answerable afterwards for a file already on disk.
    /// </para>
    /// <para>
    /// <c>deliveredDpi</c> is here for the same reason and arrived the same way, one
    /// commit later and only half as far. The engine measures the resolution every
    /// panel actually printed at — <c>effectiveDpi</c>, the exact inverse of the
    /// <c>panelWidthPxForDpi</c> every scale preset's width is derived from — and
    /// wrote it to <c>stderr</c>, which on this path is a container log nobody
    /// correlates with a PDF. The credit reached a queryable record and the
    /// measurement did not, in the same commit. On a product whose load-bearing
    /// promise is true scale, this is the number that says whether the promise was
    /// kept for the file sitting on disk, and it is not derivable from the request:
    /// nothing resamples, so the requested width is a floor and the delivered crop
    /// is 1x-2x it.
    /// </para>
    /// <para>
    /// Written with <c>JsonSerializer</c> rather than string concatenation because
    /// the column is <c>jsonb</c>: an attribution containing a quote — several real
    /// provider credits do — would otherwise produce a value Postgres refuses, and
    /// fail a render that had already succeeded.
    /// </para>
    /// </remarks>
    private static string ProvenanceOf(RenderJob job, RenderWorkerResult result) =>
        JsonSerializer.Serialize(new
        {
            attribution = result.Attribution,
            // Null for a render with no basemap: a render that drew no panels has no
            // resolution, and a 0 there would be a measurement nobody made.
            deliveredDpi = result.DeliveredDpi is { } dpi
                ? new { min = dpi.Min, max = dpi.Max, panels = dpi.Panels }
                : null,
            pageCount = result.PageCount,
            scalePresetId = job.WorkerRequest.ScalePresetId,
            tier = job.WorkerRequest.Tier,
            tileSourceId = job.WorkerRequest.TileSourceId,
            basemap = job.WorkerRequest.Basemap,
            renderedAt = DateTimeOffset.UtcNow,
        });

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

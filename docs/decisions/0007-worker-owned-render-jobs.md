# 0007 — Worker-owned render jobs: progress and cancel live where the work does

- **Status:** Accepted (2026-09-11)
- **Extends:** the API/worker boundary that `CLAUDE.md` states as "ADR 0005" — the
  API owns persistence, metadata and the lifecycle record; it owns no geometry and
  no rendering. That ADR's text does not exist; see `docs/decisions/README.md`.
- **Builds on:** [0006](0006-asynchronous-rendering.md), which took the transport
  half (202 + a status resource + a background loop) and recorded this half as
  deliberately not taken.
- **Surfaces:** `services/render-worker/src/{jobs,render-route,server}.ts`,
  `packages/render-cli/src/render.ts` (`onProgress`, `signal`,
  `RenderCancelledError`),
  `dotnet/JourneyBook.Application/Rendering/{IRenderWorkerClient,IRenderService,RenderJobs,RenderDtos}.cs`,
  `dotnet/JourneyBook.Infrastructure/Rendering/{HttpRenderWorkerClient,RenderJobRunner,RenderService,RenderCancellationRegistry}.cs`,
  `PdfStatus.Cancelled`, `GeneratedPdf.{Progress,PageCount}`,
  `apps/api/Endpoints/GeneratedPdfEndpoints.cs`,
  `apps/web/src/api/render-polling.ts`, `apps/web/src/components/GenerateButton.tsx`

## Context

ADR 0006 ends with a section headed *What this does not deliver*, and it names two
things: worker-owned progress, and cancel. Its argument for deferring them is the
argument for taking them now:

> Only the worker knows it is on page 12 of 60 — that is the entire argument for
> putting the knowledge there rather than inferring it in the API.

After 0006 the API knew exactly one fact about a render in flight: that an HTTP call
was outstanding. `Rendering` meant "the worker has it" and nothing more. The user's
whole experience of a render that can take many minutes was the word `Rendering…`,
and there was no cancel at all: aborting the client stopped the *polling* while the
render carried on to completion.

0006 also names why this is a separate decision rather than a footnote:

> The step that is deferred — worker-owned progress — does move the boundary, by
> making the worker the owner of a job's identity and state rather than a stateless
> request/response renderer. That is a boundary change and gets its own ADR when it
> is taken.

This is that ADR.

## Decision

**The worker owns a job. The API follows one.**

1. **`POST /render` answers 202** with `{ jobId, state, statusUrl }` and a `Location`
   header naming the job. It no longer holds its connection open for the render.
2. **`GET /jobs/{id}`** returns the live record — `state`, `page`, `pageCount`,
   `phase`, and on completion `outputPath` and `attribution`. **`DELETE /jobs/{id}`**
   aborts the render.
3. **`renderAtlas` takes `onProgress` and `signal`.** Progress is emitted once per
   basemap panel — the only place in a render where the time actually goes — plus a
   `contract` event carrying the page count before anything is drawn, and `pdf`/`done`
   at the end. The signal is honoured **between pages**.
4. **`HttpRenderWorkerClient` accepts the job and polls it**, reporting each *distinct*
   position through an awaited handler. `RenderJobRunner` writes those onto the
   `GeneratedPdf` row, so `GET /api/generated-pdfs/{id}` — the resource the browser
   was already polling — carries `progress` and `pageCount`.
5. **`POST /api/generated-pdfs/{id}/cancel`** cancels a token registered when the
   render was accepted. The runner links it into the render; the worker client turns
   it into a `DELETE /jobs/{id}`.
6. **`PdfStatus` gains `Cancelled`**, distinct from `Failed`.

### What did not move

Everything the worker can judge *before a job exists* still answers 400 on the POST:
the JSON schema, the tile-base-URL policy, `outputPath` confinement, and — new here —
the engine's own `assembleContract`. So an unknown scale preset, a malformed bbox,
margins that leave no printable map box and an extent over `MAX_ATLAS_PAGES` are all
still refused at the boundary with the engine's own wording, rather than becoming a
202 followed by a failed job somebody has to go and read. It costs one repeat of pure
geometry, which is milliseconds against minutes of tile fetching.

## Why this shape

**Why the worker and not the API.** Progress is a property of the process doing the
work. The API can infer that a call is outstanding; it cannot infer page 12 of 60
without either the worker telling it or the API doing the rendering, and the second
is the boundary this project exists to hold (ADR 0004/0005).

**Why cancel has to reach the worker.** Abandoning the API's HTTP request leaves the
worker rendering: it keeps fetching tiles, writes a PDF, and nobody is waiting for
it. A Cancel button wired to the client's own `AbortSignal` — which is what 0006's
"the web side is a percentage and a Cancel button" would most naturally have produced
— hides the progress bar and stops nothing. **A cancel button that does not cancel is
worse than none**, because the user believes the work stopped.

**Why the job registry is in memory.** Same reasoning 0006 applied to the API's
queue, and it is not a shortcut. A job is not restartable. Persisting its state would
let a restarted worker report progress for a render that is definitely not happening.
A job that died with its process is reported by its *absence* — the API's poll gets
404 and says "the worker restarted, generate the atlas again" — which is true, where
a persisted `rendering` row would not be.

**Why `Cancelled` is a status and not a flavour of `Failed`.** Both end with no PDF,
but one of them is what the user asked for. A cancel reported as a failure sends
someone looking for a diagnostic that does not exist. Host shutdown deliberately
stays `Failed`: nobody asked for it, so the record's advice is "generate the atlas
again", not "you stopped it".

**Why failure kind is a field.** The worker used to classify an error into an HTTP
status by matching substrings of its message, and the API read the status back out.
That mechanism is how a worker timeout came to be reported to users as a
cancellation. The kind is now decided at the catch that saw the exception, while the
exception's type is still available, and travels as `errorKind` on the job record.

## Why not the alternatives

**Server-Sent Events or a WebSocket.** 0006 said this becomes right "once there is
per-page progress to stream", and it is now closer to right — but the cost is still a
transport, and polling a resource that already exists cost nothing: the web client
was already polling `GET /api/generated-pdfs/{id}` once a second, and the progress
fields ride on the response it was already reading. Revisit if the poll cost ever
shows up.

**Keep `POST /render` synchronous and add a side-channel for progress.** Needs the
job id anyway, to address the side-channel — so it is this protocol with the
connection left open for no reason, and it keeps the worker's `requestTimeout` as a
cap on render length.

**Persist worker job state so a restarted worker can resume.** Nothing can resume a
render: the engine has no checkpoint and the panels are in memory. Persistence would
only let a restarted worker report a state it cannot honour.

**Have the API infer progress from elapsed time.** A progress bar that is a timer
dressed as a measurement. Worse than the spinner it replaces, because it is
confidently wrong about the one thing the user is reading it for.

## Consequences

### Accepted limits

- **Cancellation is between pages.** `renderMapPanel` has no signal of its own, so a
  cancel lands within one page's tile mosaic rather than instantly.
  `RenderCancelledError` carries how far it got for exactly that reason. A
  `basemap: false` render passes its last checkpoint before the accepting 202 is
  written, and is effectively uncancellable — which is honest, because such a render
  takes about a second.
- **Progress is panel-shaped.** A render without a basemap goes from `contract`
  straight to `pdf`: there is no per-page work to report. The percentage is `null`
  rather than `0` when there is no denominator, and the bar is not drawn at all in
  that case, because a bar pinned at 0% reads as a stalled render.
- **The cancel registry is in this process's memory**, like the queue. A cancel after
  a restart answers 409 `NotRunningHere` rather than doing anything; the startup
  reconciliation 0006 added is what actually fixes such a row. A second API replica
  would need the same lease or owner column 0006 already names.
- **`MAX_ACTIVE_JOBS` (default 4) is the worker's only back-pressure.** The HTTP
  connection used to provide it for free and the job protocol removes that. The
  worker is unauthenticated by design (compose `expose`, not `ports`), so this bound
  is what stands between the port and unbounded concurrent renders.
- **A finished job is readable for 15 minutes**, then swept. Longer than the API's own
  render deadline, so the answer is still there when the last poll arrives — but a
  client that never polls loses the outcome.
- **One extra database write per page.** `UpdateProgressAsync` writes the row each
  time the position changes, bounded by `MAX_ATLAS_PAGES` per render, on a render
  that takes minutes. It refuses to write to a row that is no longer
  `Pending`/`Rendering`, because the last poll and the terminal write race by
  construction.

### What this does not deliver

- **Concurrency on the worker.** `MAX_ACTIVE_JOBS` is a bound, not a scheduler: over
  it, the worker answers 429 rather than queuing. The API sends one render at a time
  (ADR 0006), so nothing legitimate meets it today.
- **Progress for a render started in another tab.** The project's PDF history shows
  status, not position.
- **A resumable render.** Cancelling or losing a render loses all of its work.

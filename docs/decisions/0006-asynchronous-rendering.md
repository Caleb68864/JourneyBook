# 0006 — Asynchronous rendering: the API accepts, a background loop performs

- **Status:** Accepted (2026-09-09)
- **Supersedes:** the synchronous render path introduced with the render-worker in
  Phase C. Nothing is superseded in text, because that decision's text was never
  tracked — see `docs/decisions/README.md`.
- **Surfaces:** `apps/api/Endpoints/RenderEndpoints.cs`,
  `dotnet/JourneyBook.Application/Rendering/RenderJobs.cs`,
  `dotnet/JourneyBook.Infrastructure/Rendering/{RenderService,RenderJobRunner,RenderJobProcessor,ChannelRenderJobQueue}.cs`,
  `apps/web/src/api/render-polling.ts`, `apps/web/src/components/GenerateButton.tsx`,
  `GeneratedPdf.ErrorMessage`

## Context

`POST /api/projects/{id}/render` blocked for the entire render. The web app's
Generate button sat on that one call behind an indefinite spinner
(`GenerateButton.tsx`, before this change), and a 60-page atlas behind it is 60
sequential basemap fetches. Every timeout between the browser and the API — the
browser's own, any reverse proxy, the `RenderWorker:TimeoutSeconds` of 120 — turned a
render that was going fine into a failed request, with a `GeneratedPdf` row left
behind in a state nobody was watching.

The persistence for the alternative already existed and had existed since the schema
was written. `PdfStatus` runs `Pending → Rendering → Completed → Failed`. The row is
created **before** the worker is invoked. `GET /api/generated-pdfs/{id}` reads it. What
was missing was not storage; it was transport and ownership. Nothing had ever set
`Rendering`, because in a single blocking call there was no moment at which anyone
could have observed it.

## Decision

**The POST accepts a render; it does not perform one.**

1. `RenderService` still does all of the reading — resolve the project graph, its
   extent, locations and landmarks; validate; create the `Pending` row; build the
   worker request — inside the HTTP request's own scope. It then enqueues the
   **already-built** request and returns.
2. The endpoint answers **202 Accepted** with `{ generatedPdfId, status: "Pending",
   downloadUrl, statusUrl }` and a `Location` header naming the *status* resource, not
   the PDF, which does not exist yet.
3. `RenderJobProcessor` (a `BackgroundService`) drains the queue one job at a time,
   opening a fresh DI scope per job, and hands each to `RenderJobRunner`.
4. `RenderJobRunner` marks the row `Rendering`, calls the worker, then marks it
   `Completed` (with the output path) or `Failed` (with the renderer's diagnostic).
5. The web app polls `GET /api/generated-pdfs/{id}` via `waitForRender` until the row
   is terminal, and only then opens the download URL.

The job carries the built `RenderWorkerRequest` rather than a project id, so the
background work never reads the database and cannot render a project as it was edited
between the click and the render. The atlas that comes out is the atlas that was asked
for.

`GeneratedPdf` gains a nullable `ErrorMessage` (migration
`20260909203948_AddGeneratedPdfErrorMessage`, max length 2000). Without it the 202
would be a regression: the old 502 carried the worker's diagnostic in its body, and a
render that fails after the request has ended has no response left to ride home on.
The user's whole answer would have been the word "Failed".

## Why not the alternatives

**Keep blocking and raise the timeouts.** Moves the number, not the problem, and the
number that has to move is in the browser, the proxy and the API. The 200-page cap
means the worst case is bounded only by `MAX_ATLAS_PAGES`.

**Server-Sent Events or a WebSocket instead of polling.** Better once there is
per-page progress to stream. Today the API knows only "an HTTP call is outstanding" —
a stream of that is a stream of one fact. Polling a resource that already exists cost
one new client module; a push channel would have cost a transport, and the transport
is not the missing piece.

**Have the worker own the job now.** This is the right end state and is *not* done —
see below. The 202 is the step that had to come first regardless of who owns the job,
because it is the transport change; job ownership is a protocol change on top of it.

## Consequences

### Accepted limits

- **The queue is in this process's memory.** Restart the API with work outstanding and
  those rows sit at `Pending` or `Rendering` for ever — nothing resumes an in-flight
  job. Acceptable for the single-instance deployment the Compose file describes;
  **not** acceptable for more than one API replica, where each instance would drain
  its own queue and neither would see the other's work. Recorded at the top of
  `ChannelRenderJobQueue`.
- **One render at a time.** A queued user waits for the one in front. This is
  deliberate: concurrent renders multiply sequential tile fetches against USGS through
  the proxy for no gain to the person actually waiting. Concurrency belongs on the
  worker side.
- **A cancelled or shut-down render is marked `Failed`**, not `Cancelled`. It left
  nothing on disk.
- **A row a crash left behind is reconciled at startup, not left for retention.** The
  clause here used to read "a row left at `Rendering` is stranded for its whole
  retention window", which only ever made sense if something eventually cleared it.
  Nothing did: the retention sweep is `PruneExpiredAsync`, `ExpiresAt < now`, and a row
  stranded ten seconds ago by a `SIGKILL` is not expired. `RenderJobProcessor` now
  calls `IGeneratedPdfService.FailStrandedAsync` before it dequeues its first job. This
  is sound *because* the queue is in-process — at the instant this host starts, nothing
  is rendering — and it is one more reason a second API replica needs a lease or an
  owner column first: it would fail the other instance's live renders.

### What this does *not* deliver

**Worker-owned progress, and cancel.** Only the worker knows it is on page 12 of 60 —
that is the entire argument for putting the knowledge there rather than inferring it
in the API. Delivering it needs, roughly:

- a job protocol on the worker: `POST /render` returns a job id immediately, plus
  `GET /jobs/{id}` (`{ state, page, pageCount }`) and `DELETE /jobs/{id}`;
- `renderAtlas` reporting page-level progress through a callback, and honouring an
  `AbortSignal` between pages;
- the API proxying both — status into the existing `GET /api/generated-pdfs/{id}`
  (new `progress`/`pageCount` fields) and a new `POST /api/generated-pdfs/{id}/cancel`;
- a `Cancelled` member on `PdfStatus`, distinct from `Failed`, with the migration for
  it;
- `waitForRender` already carries an `AbortSignal` and an `onStatus` callback, so the
  web side is a percentage and a Cancel button rather than a rewrite.

Until that lands, `Rendering` means "the worker has it", the progress indicator says
`Queued…` / `Rendering…` and nothing more, and there is no cancel: aborting the client
stops the *polling*, and the render finishes into the project's PDF history.

## Relationship to the API/worker boundary

This change stays inside the boundary the codebase holds and `CLAUDE.md` states as
"ADR 0005": the API owns persistence, metadata and the lifecycle record; it owns no
geometry and no rendering. The background loop added here calls the same
`IRenderWorkerClient` the request thread used to call, with the same payload. What
moved is *when* the call happens relative to the HTTP response, not *who* renders.

The step that is deferred — worker-owned progress — does move the boundary, by making
the worker the owner of a job's identity and state rather than a stateless
request/response renderer. That is a boundary change and gets its own ADR when it is
taken, not a footnote in this one.

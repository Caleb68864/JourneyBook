# Architecture Decision Records

One file per decision, `NNNN-kebab-title.md`, numbered in the order they were taken.
This directory is **tracked** — see the `!docs/decisions/` exception in `.gitignore`.
Everything else under `docs/` is ignored working material.

An ADR is for a decision that constrains future changes: a boundary between
components, an ownership rule, a technology commitment. A bug fix or a workaround is
not an ADR — those go in `docs/decisions.md`, the decision log, which the pre-commit
hook enforces.

## The gap in the record

ADRs **0001 and 0003–0005 are cited as binding across the repo and their text does not
exist.** They are named by `CLAUDE.md`, `forge-project.json`, `README.md`,
`packages/map-sources/src/panel.ts`, `apps/web/src/routes/ProjectEditorPage.tsx`,
`dotnet/JourneyBook.Infrastructure/GeneratedPdfs/GeneratedPdfService.cs`,
`dotnet/JourneyBook.Application/GeneratedPdfs/IGeneratedPdfService.cs`,
`scripts/render-fidelity-check.mjs` and both roadmaps — and by none of them in a form
anyone could read.

The cause is recorded in `docs/decisions.md` (2026-06-24 entry): *"The `docs/*`
.gitignore means Phase C specs/ADRs (e.g. docs/decisions/0005) are untracked even when
written."* Whether they were written and lost, or never written, cannot now be told
from the repo.

That is fixed here only in the sense that the directory is now tracked, so it cannot
happen again. **Reconstructing 0001/0003/0004/0005 from the code and the surviving
one-line paraphrases is its own piece of work and has not been done.** Until it is,
these are the only authoritative statements of those rules, both in `CLAUDE.md`:

- **0004** — "TS `atlas-core` is the one source of truth for geometry; never
  reimplement projection/grid/scale math in C#." Verified still held as of
  2026-09-09: an exhaustive search for trigonometry, earth radii and degree/radian
  conversion across `dotnet/` and `apps/api/` found none
  (`vault/maintainability-2026-09-09.md` §8). Nothing enforces it mechanically.
- **0005** — "The API owns no geometry/render"; it proxies render jobs to the Node
  `render-worker` over HTTP. ADR 0006 in this directory extends that boundary and
  states what it found there; **ADR 0007 moves it**, by making the worker the owner
  of a job's identity and state rather than a stateless request/response renderer.
  0007 is the fullest surviving statement of where that boundary now sits.

Do not cite 0001, 0003, 0004 or 0005 as though a reader can look them up. Cite what
the code does, or write the ADR.

## Index

| # | Title | Status |
|---|---|---|
| 0001 | Foundation stack | **text missing** — cited by `staged-build-roadmap.md:222` |
| 0003 | Map panel rendering (USGS raster tiles) | **text missing** — cited by `panel.ts:339` |
| 0004 | `atlas-core` owns all geometry | **text missing** — cited in eight places |
| 0005 | The API owns no geometry or rendering | **text missing** — cited in five places |
| [0006](0006-asynchronous-rendering.md) | Asynchronous rendering: the API accepts, a background loop performs | Accepted |
| [0007](0007-worker-owned-render-jobs.md) | Worker-owned render jobs: progress and cancel live where the work does | Accepted |

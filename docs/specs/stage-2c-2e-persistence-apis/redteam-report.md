---
type: redteam-report
generated: 2026-06-24
findings_count: 4
critical: 1
advisory: 3
patched: 3
---

# Red Team Review: 2026-06-24-stage-2c-2e-persistence-apis.md

9-role adversarial review of the Stage 2C-2E persistence spec (4 sub-specs). The spec entered well-formed (evaluated, committed contracts). One genuine security bug and two build-safety clarifications were found and patched; one advisory is accepted as consistent with the documented MVP.

## CRITICAL Findings (1)

**C-1: Path traversal in `prune` file deletion** (Security Auditor) — PATCHED
- Location: SS-04 `PruneExpiredAsync`.
- Issue: `File.Delete(Path.Combine(GeneratedDir, FilePath))` with user-supplied `FilePath` (set via `PUT /api/generated-pdfs/{id}/status`) could resolve outside `data/generated/` (e.g. `../../…`) and delete arbitrary files.
- Fix applied: resolve `Path.GetFullPath(...)` and only delete when the result `StartsWith` the resolved `GeneratedDir` root; skip (do not throw) otherwise. Patched in the master spec SS-04 Decisions and `sub-spec-4-generated-pdf-records.md` step 4.

## ADVISORY Findings (3)

**A-1: NOT NULL column add safety** (Data/Migration Steward) — PATCHED
- `ImportantLocation.LocationNumber` is `NOT NULL`. Added `HasDefaultValue(0)` so the `Stage2Persistence` migration is safe even if rows pre-exist. Patched in `sub-spec-1-schema-deltas.md`.

**A-2: Owned-type seed must modify existing `OwnsOne`** (Developer Implementer) — PATCHED
- `TileSourceConfiguration` already calls `OwnsOne(t => t.Cache)` (from Stage 2A). SS-01 must chain `.HasData(...)` onto that call, not add a second `OwnsOne` (would not compile). Clarified in `sub-spec-1-schema-deltas.md`.

**A-3: Unauthenticated endpoints + future SSRF** (Security Auditor) — ACCEPTED (no change)
- The new endpoints have no authorization. This is consistent with the **documented single-user / no-auth MVP** (Locked Decisions in the roadmap). Storing an arbitrary `TileSource.SourceUrl` becomes an SSRF surface only when the **Stage 3** tile proxy fetches it — flagged there, out of scope for 2C-2E. No change to this spec.

## Role Scorecards
Developer: 1 | QA: 0 | End User: 0 | Architect: 0 | Scope Realist: 0 | Security: 2 | SRE: 0 | Data: 1 | Product: 0

## Verdict
Ready for the factory. The wave structure (SS-01 migration serial; SS-02/03/04 sequential dispatch) avoids the shared-`ModelSnapshot`/shared-file conflicts; acceptance criteria are typed and Docker-backed; the one real security bug is fixed.

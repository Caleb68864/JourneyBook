# Decision Log

Record fixes, workarounds, and intentional trade-offs here. A pre-commit hook (`scripts/hooks/pre-commit`) scaffolds a placeholder entry on any code commit that lacks one, and blocks commits whose decisions.md still contains an unfilled placeholder. Bypass (sparingly): `git commit --no-verify`.

Each entry follows this shape:

- **Symptom:** what the user / future reader experienced or saw.
- **Fix:** what was done.
- **Surfaces:** greppable tokens (file paths, symbol names) so future debugging can find this entry via `grep -r <token> docs/decisions.md`.
- **Watch:** what could go wrong next, or a related edge case. Use "None" if nothing applies.
- **Commit:** the commit SHA the Fix landed in (filled at commit time, can be "(pending)").

**Never include secrets, tokens, connection strings, or PII in entries — this file is committed.**

---

## 2026-06-24 — Install decision log enforcement
- Symptom: No structured record of why changes were made across this repo's history.
- Fix: Installed pre-commit decision-log enforcement per forge-init Step 6g (mixed Node/TS + .NET filter).
- Surfaces: scripts/hooks/pre-commit, docs/decisions.md, CLAUDE.md, forge-project.json
- Watch: Commits bypassing with `--no-verify` escape the log; the factory's `[factory-managed]` commits (committer email == forge.json git_username "caleb") are intentionally exempt.
- Commit: (populated at commit time)

## 2026-06-24 — Stage 2C-2E SS-04 wiring gaps left by the dark factory
- Symptom: After the dark-factory run (partial_success — SS-01 hollow-success deferred under strict-order; gap-sweep bailed on sustained 429s), the GeneratedPdfs API tests failed. Mapping the endpoints then cratered the WHOLE suite to 26 failures (every endpoint 500'd with "Failure to infer one or more parameters: service → UNKNOWN").
- Fix: The SS-04 worker created GeneratedPdfEndpoints + GeneratedPdfService but never (a) wired `app.MapGeneratedPdfEndpoints()` into Program.cs nor (b) registered `AddScoped<IGeneratedPdfService, GeneratedPdfService>()`. An unresolved minimal-API service param fails the entire route-table build, not just that endpoint. Added both. Also fixed a test that asserted byte-exact equality of a `jsonb` column (Postgres normalizes key order/whitespace) → compare with `JsonNode.DeepEquals`.
- Surfaces: apps/api/Program.cs, dotnet/JourneyBook.Infrastructure/DependencyInjection.cs, dotnet/JourneyBook.Tests/Api/GeneratedPdfsApiTests.cs, MapGeneratedPdfEndpoints, IGeneratedPdfService, SourceMetadataSnapshot
- Watch: A missing minimal-API DI registration is a whole-app failure (route table build), not a localized 404/500 — check DI registration first when many endpoints 500 at once. Factory strict-order + a hollow-success on the first sub-spec blocks all downstream sub-specs.
- Commit: (populated at commit time)

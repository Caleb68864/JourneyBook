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

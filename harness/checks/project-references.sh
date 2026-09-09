#!/usr/bin/env bash
# harness/checks/project-references.sh -- every workspace import must have a
# matching TypeScript project reference.
#
# `tsc -b` builds a project's references before the project itself. A workspace
# that imports `@journeybook/x` without referencing it is not built in dependency
# order: `tsc` resolves the import through `x`'s package.json `main`, which points
# at `dist`, so it typechecks against whatever `dist` happened to contain from a
# previous build. A stale or missing dist gives either a phantom pass against last
# week's types or a "cannot find module" that looks like a broken install.
#
# Two of these existed. `packages/pdf-client` imported `@journeybook/ui` and
# referenced only `atlas-core`. `apps/web/tsconfig.app.json` imported both
# `atlas-core` and `ui` and referenced neither -- and `infra/docker/web.Dockerfile`
# already carried the workaround, building `--filter @journeybook/web...` with a
# comment explaining that web's `tsc -b` cannot resolve `@journeybook/*` unless
# their dists exist first. A build-order bug worked around in the Dockerfile is
# still a build-order bug.
#
# This check reads the imports out of the source and the references out of the
# configs, so it stays true as either changes.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

node --input-type=module -e '
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

/** Workspaces that consume other workspaces. */
const workspaces = [
  "packages/atlas-core",
  "packages/map-sources",
  "packages/pdf-client",
  "packages/render-cli",
  "packages/ui",
  "services/render-worker",
  "apps/web",
];

/** @journeybook/<name> -> workspace directory. */
const provider = new Map();
for (const ws of workspaces) {
  const pkgPath = path.join(root, ws, "package.json");
  if (!existsSync(pkgPath)) continue;
  const name = JSON.parse(readFileSync(pkgPath, "utf8")).name;
  if (name) provider.set(name, ws);
}

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const p = path.join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Referenced project paths, resolved, across every tsconfig in a workspace. */
function referencedProjects(ws) {
  const refs = new Set();
  const dir = path.join(root, ws);
  for (const entry of readdirSync(dir)) {
    if (!/^tsconfig.*\.json$/.test(entry)) continue;
    let cfg;
    try {
      cfg = JSON.parse(readFileSync(path.join(dir, entry), "utf8"));
    } catch {
      continue;
    }
    for (const ref of cfg.references ?? []) {
      if (ref?.path) refs.add(path.relative(root, path.resolve(dir, ref.path)));
    }
  }
  return refs;
}

let failed = 0;
for (const ws of workspaces) {
  const imports = new Set();
  for (const file of sourceFiles(path.join(root, ws, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/["\x27](@journeybook\/[a-z0-9-]+)["\x27]/g)) {
      imports.add(m[1]);
    }
  }
  const refs = referencedProjects(ws);
  const missing = [];
  for (const dep of imports) {
    const dir = provider.get(dep);
    if (!dir || dir === ws) continue;
    if (!refs.has(dir)) missing.push(`${dep} (${dir})`);
  }
  if (missing.length) {
    console.error(`FAIL: ${ws} imports ${missing.join(", ")} without a project reference`);
    failed = 1;
  } else if (imports.size) {
    console.log(`  ok: ${ws} references all ${imports.size} workspace import(s)`);
  } else {
    console.log(`  skip: ${ws} imports no workspace package`);
  }
}

if (!failed) console.log("PASS: every workspace import has a project reference");
process.exit(failed);
'

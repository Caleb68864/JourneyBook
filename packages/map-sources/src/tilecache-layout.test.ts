import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCachedTile, storeCachedTile } from "./tilecache.js";

/**
 * The disk tile cache is implemented twice, in two languages, on purpose — the
 * headless CLI and the API proxy share one cache directory and neither language
 * can call the other. "On purpose" only holds while the two agree, and nothing
 * compared them: `tile-content-types.json` pinned the extension mapping, and the
 * layout and hit rule — the parts that decide whether a tile written by one side
 * is ever FOUND by the other — were two independent copies of a comment.
 *
 * This is the TypeScript half. `dotnet/JourneyBook.Tests/TileCacheLayoutParityTests.cs`
 * is the C# half, reading the same file. A rule changed in one language fails both.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = join(REPO_ROOT, "data", "fixtures", "tile-cache-layout.json");

interface LayoutCase {
  source: string;
  z: number;
  x: number;
  y: number;
  ext: string;
  relativePath: string;
}
interface HitCase {
  y: number;
  name: string;
  isHit: boolean;
  why: string;
}
interface Fixture {
  layout: LayoutCase[];
  hitNames: HitCase[];
  escapingKeys: string[];
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "jb-cache-layout-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the shared tile-cache layout", () => {
  it("[CONTROL] the fixture was actually read", () => {
    // A fixture that parsed to nothing would let every loop below iterate zero
    // times and report success on no comparison at all.
    expect(fixture.layout.length).toBeGreaterThan(1);
    expect(fixture.hitNames.length).toBeGreaterThan(4);
    expect(fixture.escapingKeys.length).toBeGreaterThan(1);
    // And both answers must be represented, or "isHit" is a constant.
    expect(fixture.hitNames.some((h) => h.isHit)).toBe(true);
    expect(fixture.hitNames.some((h) => !h.isHit)).toBe(true);
  });

  it("[BEHAVIORAL] writes each tile exactly where the shared layout says", async () => {
    for (const c of fixture.layout) {
      await storeCachedTile(root, c.source, c.z, c.x, c.y, c.ext, Buffer.from(`${c.relativePath}`));
      expect(
        existsSync(join(root, c.relativePath)),
        `stored ${c.source}/${c.z}/${c.x}/${c.y}.${c.ext} somewhere other than ${c.relativePath}`,
      ).toBe(true);
    }
  });

  it("[BEHAVIORAL] reads back a tile the other implementation could have written", async () => {
    for (const c of fixture.layout) {
      // Written by path, not through storeCachedTile: this is the half that
      // matters across the language boundary — bytes the C# proxy put there.
      const dir = join(root, c.source, String(c.z), String(c.x));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${c.y}.${c.ext}`), Buffer.from("tile"));

      const hit = await getCachedTile(root, c.source, c.z, c.x, c.y);
      expect(hit, `missed ${c.relativePath}, which the C# side would have written`).not.toBeNull();
      expect(hit!.ext).toBe(c.ext);
    }
  });

  it("[BEHAVIORAL] agrees on which filenames are a finished tile", async () => {
    for (const c of fixture.hitNames) {
      const dir = join(root, "hitrule", String(c.name.length), "0");
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, c.name), Buffer.from("bytes"));

      const hit = await getCachedTile(root, "hitrule", c.name.length, 0, c.y);
      expect(hit !== null, `${c.name} for y=${c.y}: ${c.why}`).toBe(c.isHit);
    }
  });

  it("[BEHAVIORAL] treats an escaping source key as a miss and writes nothing", async () => {
    for (const key of fixture.escapingKeys) {
      await storeCachedTile(root, key, 1, 2, 3, "png", Buffer.from("escaped"));
      expect(await getCachedTile(root, key, 1, 2, 3)).toBeNull();
    }
    // The control for the loop above: a NORMAL key must still store and read back,
    // or "wrote nothing" is satisfied by a cache that never writes anything.
    await storeCachedTile(root, "control-source", 1, 2, 3, "png", Buffer.from("kept"));
    expect(await getCachedTile(root, "control-source", 1, 2, 3)).not.toBeNull();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCachedTile, storeCachedTile } from "./tilecache.js";

const roots: string[] = [];
async function tmpRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jb-node-tilecache-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const r of roots.splice(0)) {
    await fs.rm(r, { recursive: true, force: true });
  }
});

describe("tilecache", () => {
  it("returns null on a miss", async () => {
    const root = await tmpRoot();
    expect(await getCachedTile(root, "usgs-topo", 2, 1, 1)).toBeNull();
  });

  it("round-trips bytes and discovers the stored ext", async () => {
    const root = await tmpRoot();
    const payload = Buffer.from([1, 2, 3, 4]);
    await storeCachedTile(root, "usgs-topo", 5, 9, 9, "png", payload);

    const hit = await getCachedTile(root, "usgs-topo", 5, 9, 9);
    expect(hit).not.toBeNull();
    expect(hit!.bytes.equals(payload)).toBe(true);
    expect(hit!.ext).toBe("png");
  });

  it("does not write outside the cache root for a traversal key", async () => {
    const root = await tmpRoot();
    const probe = path.resolve(root, "..", "jb-node-escape-probe.png");
    await fs.rm(probe, { force: true });

    await storeCachedTile(root, "../jb-node-escape-dir", 0, 0, 0, "png", Buffer.from([9]));

    await expect(fs.access(probe)).rejects.toBeTruthy();
    expect(await getCachedTile(root, "../jb-node-escape-dir", 0, 0, 0)).toBeNull();
  });
});

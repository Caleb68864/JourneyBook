import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AtlasContract } from "./index.js";
import { validateAtlas } from "./validation.js";

/** Golden fixture: a known-good 2x2 atlas the harness must keep accepting. */
describe("golden fixture", () => {
  it("the committed sample atlas validates", () => {
    const path = fileURLToPath(
      new URL("../../../data/fixtures/sample-atlas.json", import.meta.url),
    );
    const contract = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as AtlasContract;

    expect(contract.pages).toHaveLength(4);
    expect(contract.pages.map((p) => p.id)).toEqual(["A1", "A2", "B1", "B2"]);
    expect(validateAtlas(contract).pass).toBe(true);
  });
});

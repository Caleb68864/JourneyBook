import { describe, it, expect } from "vitest";
import { TIER_OPTIONS } from "./TierPicker";

/**
 * The picker must only offer tiers the renderer actually draws. `AtlasDocument`
 * gates every piece of extra furniture on `tier >= 3`, so a Tier 4 page prints
 * byte-for-byte like a Tier 3 one — offering "full MGRS & azimuth" sold a
 * feature the PDF does not deliver. The roadmap records Level 4 as deferred;
 * this test keeps the UI honest about that until a renderer implements it.
 */
describe("TierPicker options", () => {
  it("offers only the tiers the renderer implements", () => {
    expect(TIER_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3]);
  });

  it("does not advertise unimplemented Level 4 furniture", () => {
    const copy = TIER_OPTIONS.map((o) => `${o.label} ${o.description}`).join(" ").toLowerCase();
    expect(copy).not.toContain("mgrs");
    expect(copy).not.toContain("azimuth");
    expect(copy).not.toContain("tier 4");
  });

  it("describes every offered tier", () => {
    for (const option of TIER_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

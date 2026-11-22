import { describe, it, expect } from "vitest";
import { TIER_OPTIONS } from "./TierPicker";

/**
 * The picker must only offer tiers the renderer actually draws, and say only what each one draws.
 * Tier 4 was withheld while it printed byte-for-byte like Tier 3; since 2026-11-22 it draws the
 * declination diagram (pdf-client `declination-diagram.test.ts`) and full MGRS labels
 * (render-cli `furniture.test.ts`), and nothing more, so its copy may name those but not
 * azimuth worksheets.
 */
describe("TierPicker options", () => {
  it("offers the tiers the renderer implements", () => {
    expect(TIER_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3, 4]);
  });

  it("describes Tier 4 as what it draws, and advertises nothing still unbuilt", () => {
    const tier4 = TIER_OPTIONS.find((o) => o.value === 4)!;
    expect(tier4.description.toLowerCase()).toContain("declination");
    expect(tier4.description).toContain("MGRS");
    const copy = TIER_OPTIONS.map((o) => `${o.label} ${o.description}`).join(" ").toLowerCase();
    expect(copy).not.toContain("azimuth");
    expect(copy).not.toContain("worksheet");
  });

  it("describes every offered tier", () => {
    for (const option of TIER_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

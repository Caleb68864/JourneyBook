import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CROP_MARK, mapBoxOf, measurePdfPages } from "@journeybook/pdf-client";
import { renderAtlas } from "./render.js";
import { inputFromArgs } from "./cli.js";

/**
 * Stage 1D's crop marks and locator inset reach the printed file through the engine, and the
 * CLI flags reach the engine. `pdf-client`'s own tests draw them; this is the hop before that,
 * the one a new renderer option is usually lost on.
 */

/** Whether a page carries a horizontal crop tick off the map box's top-left corner. */
function hasTopLeftTick(pdf: Buffer): boolean {
  const page = measurePdfPages(pdf)[0]!;
  const box = mapBoxOf(page, 1)!;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  return page.rects.some(
    (r) => near(r.x, box.x - CROP_MARK.gap - CROP_MARK.length) && near(r.y, box.y - CROP_MARK.stroke / 2) && near(r.width, CROP_MARK.length),
  );
}

async function renderTo(extra: Record<string, unknown>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "jb-furniture-"));
  try {
    const out = join(dir, "a.pdf");
    await renderAtlas({
      mode: "location",
      center: { lng: -96.7, lat: 40.8 },
      scalePresetId: "usgs-7-5-min",
      tier: 1,
      outputPath: out,
      ...extra,
    });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Stage 1D furniture through renderAtlas", () => {
  it("[BEHAVIORAL] cropMarks: true prints the crop ticks; the default prints none", async () => {
    expect(hasTopLeftTick(await renderTo({ cropMarks: true }))).toBe(true);
    expect(hasTopLeftTick(await renderTo({}))).toBe(false);
  });

  it("the CLI flags set the engine options, and leave them off without the flags", () => {
    const base = ["--location", "-96.7,40.8", "--scale", "usgs-7-5-min"];
    expect(inputFromArgs([...base, "--crop-marks", "--locator-inset"])).toMatchObject({ cropMarks: true, locatorInset: true });
    const plain = inputFromArgs(base) as Record<string, unknown>;
    expect(plain["cropMarks"]).toBeUndefined();
    expect(plain["locatorInset"]).toBeUndefined();
  });
});

describe("Stage 6B Level 4 declination through renderAtlas", () => {
  const texts = async (extra: Record<string, unknown>) => {
    const pdf = await renderTo(extra);
    return measurePdfPages(pdf)[0]!.texts;
  };

  it("[BEHAVIORAL] a tier-4 render prints its page's three norths for the declination date", async () => {
    const printed = await texts({ tier: 4, declinationDate: "2026-07-02" });
    expect(printed.some((t) => /^MN \d+\.\d° [EW] · GN \d+\.\d° [EW] \(UTM 14\) of true N$/.test(t))).toBe(true);
    expect(printed.some((t) => /^G-M \d+\.\d° [EW] · WMM2025 2026\.5 · /.test(t))).toBe(true);
  });

  it("[CONTROL] tier 3 prints no declination", async () => {
    const printed = await texts({ tier: 3, declinationDate: "2026-07-02" });
    expect(printed.some((t) => t.startsWith("MN ") || t.startsWith("G-M "))).toBe(false);
  });

  it("a date the model does not cover is printed as such, not extrapolated", async () => {
    const printed = await texts({ tier: 4, declinationDate: "2031-01-01" });
    expect(printed.some((t) => t.startsWith("Declination not shown: WMM2025 is valid for 2025.0 to 2030.0"))).toBe(true);
    expect(printed.some((t) => t.startsWith("G-M "))).toBe(false);
  });

  it("refuses a malformed date, and the CLI flag reaches the engine", async () => {
    await expect(renderTo({ tier: 4, declinationDate: "2026-7-2" })).rejects.toThrow(/must be a real YYYY-MM-DD date/);
    // The right shape but no such day: it used to become NaN and print "NaN is outside it".
    await expect(renderTo({ tier: 4, declinationDate: "2026-13-01" })).rejects.toThrow(/must be a real YYYY-MM-DD date/);
    await expect(renderTo({ tier: 4, declinationDate: "2026-02-30" })).rejects.toThrow(/must be a real YYYY-MM-DD date/);
    expect(
      inputFromArgs(["--location", "-96.7,40.8", "--scale", "usgs-7-5-min", "--declination-date", "2026-07-02"]),
    ).toMatchObject({ declinationDate: "2026-07-02" });
  });
});

describe("Stage 6B Level 4 full MGRS labels through renderAtlas", () => {
  /** A page centred on the 100 km easting line 700000 in zone 14 (central Nebraska, 41°N). */
  const BOUNDARY = { lng: -96.62, lat: 40.82 };

  async function page(tier: 3 | 4) {
    const dir = mkdtempSync(join(tmpdir(), "jb-mgrs-"));
    try {
      const out = join(dir, "a.pdf");
      await renderAtlas({
        mode: "location",
        center: BOUNDARY,
        scalePresetId: "usgs-7-5-min",
        tier,
        declinationDate: "2026-07-02",
        outputPath: out,
      });
      return measurePdfPages(readFileSync(out))[0]!;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The PDF shows a string in pieces where the font kerns ("14" then "T PL"), so join the pieces
   * that sit on one baseline next to each other back into the words a reader sees.
   */
  function words(m: Awaited<ReturnType<typeof page>>): string[] {
    const rows = new Map<number, (typeof m.textItems)[number][]>();
    for (const t of m.textItems) {
      const key = Math.round(t.y * 10) / 10;
      rows.set(key, [...(rows.get(key) ?? []), t]);
    }
    const out: string[] = [];
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      let current = "";
      let end = -Infinity;
      for (const t of row) {
        if (t.x - end > t.size * 1.5 && current) {
          out.push(current);
          current = "";
        }
        current += t.text;
        end = t.x + t.text.length * t.size * 0.6;
      }
      if (current) out.push(current);
    }
    return out;
  }

  it("[BEHAVIORAL] tier 4 names every 100 km square on the page and labels the first lines in full", async () => {
    const m = await page(4);
    const seen = words(m);
    const squareIds = seen.filter((t) => /^\d{1,2}[C-X] [A-Z]{2}$/.test(t));
    expect(new Set(squareIds).size, `square ids: ${squareIds.join(", ")}`).toBe(2);
    expect(seen.some((t) => /^\d{6}mE$/.test(t))).toBe(true);
    expect(seen.some((t) => /^\d{7}mN$/.test(t))).toBe(true);
    const collar = seen.find((t) => t.endsWith("· MGRS"));
    expect(collar, "no MGRS collar").toBeDefined();
    for (const id of new Set(squareIds)) expect(collar).toContain(id);

    // The collar shares the footer with the declination caption and the page number. Widths are
    // estimated at 0.5 em, Helvetica's measured average for these strings (0.49); the collar is
    // shown in pieces where the font kerns, so it starts at its row's first piece right of the
    // caption.
    const items = m.textItems;
    const right = (t: (typeof items)[number]) => t.x + t.text.length * t.size * 0.5;
    const caption = items.filter((t) => t.text.startsWith("MN ") || t.text.startsWith("G-M ") || t.text.startsWith("Declination"));
    const captionX = Math.min(...caption.map((c) => c.x));
    const collarTail = items.find((t) => t.text.endsWith("· MGRS"))!;
    const collarRow = items.filter((t) => Math.abs(t.y - collarTail.y) < 0.2 && t.x > captionX);
    const collarStart = Math.min(...collarRow.map((t) => t.x));
    const pageNumber = items.find((t) => t.size === 11 && /^\d+$/.test(t.text))!;
    expect(right(collarTail)).toBeLessThan(pageNumber.x);
    for (const c of caption) expect(right(c)).toBeLessThan(collarStart);
  });

  it("[CONTROL] tier 3 keeps the USNG collar and two-digit labels", async () => {
    const m = await page(3);
    const seen = words(m);
    expect(seen.some((t) => t.endsWith("· USNG"))).toBe(true);
    expect(seen.some((t) => t.endsWith("· MGRS"))).toBe(false);
    expect(seen.some((t) => /\d+m[EN]$/.test(t))).toBe(false);
  });
});

describe("Stage 6B Level 4 azimuth worksheet through renderAtlas", () => {
  const STOPS = [
    { center: { lng: -96.7026, lat: 40.8136 }, label: "Capitol" },
    { center: { lng: -96.7116, lat: 40.8169 }, label: "Haymarket" },
    { center: { lng: -96.7734, lat: 40.7786 }, label: "Pioneers" },
  ];

  it("[BEHAVIORAL] worksheet: true, tier: 4 appends the worksheet and key, one leg per consecutive pair", async () => {
    const pdf = await renderTo({ mode: "location", locations: STOPS, worksheet: true, tier: 4, declinationDate: "2026-07-02", tableOfContents: false, overview: false });
    const pages = measurePdfPages(pdf);
    expect(pages).toHaveLength(STOPS.length + 2);
    const key = pages.at(-1)!.texts;
    expect(key).toContain("ANSWER KEY");
    expect(key).toContain("L1 Capitol to L2 Haymarket");
    expect(key).toContain("L2 Haymarket to L3 Pioneers");
    expect(key.some((t) => t.startsWith("L3 Pioneers to"))).toBe(false);
    // Each leg names the pages it crosses, ending on the page of its finish. Haymarket is about a
    // kilometre from the Capitol, so it is on page L1 too, and the second leg starts on both.
    const lists = key.filter((t) => t.startsWith("pages "));
    expect(lists).toEqual(["pages L1, L2", expect.stringMatching(/^pages (L1, )?L2, L3$/)]);
  });

  it("[CONTROL] off by default, and skipped with fewer than two locations", async () => {
    expect(measurePdfPages(await renderTo({ mode: "location", locations: STOPS, tableOfContents: false, overview: false }))).toHaveLength(3);
    expect(measurePdfPages(await renderTo({ worksheet: true, tier: 4 }))).toHaveLength(1);
    // Below tier 4 there is no G-M angle on the page to measure with, so it is refused.
    await expect(renderTo({ mode: "location", locations: STOPS, worksheet: true, tier: 3 })).rejects.toThrow(/worksheet needs tier 4/);
    expect(inputFromArgs(["--location", "-96.7,40.8", "--scale", "usgs-7-5-min", "--worksheet"])).toMatchObject({ worksheet: true });
  });
});

describe("a page across a UTM zone boundary through renderAtlas", () => {
  it("[BEHAVIORAL] tier 3 marks the zone junction; tier 4 names both zones' squares in the collar", async () => {
    const render = async (tier: 3 | 4) => {
      const dir = mkdtempSync(join(tmpdir(), "jb-junction-"));
      try {
        const out = join(dir, "a.pdf");
        await renderAtlas({ mode: "location", center: { lng: -102, lat: 40.8 }, scalePresetId: "usgs-7-5-min", tier, declinationDate: "2026-07-02", outputPath: out });
        return measurePdfPages(readFileSync(out))[0]!.texts.join("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    expect(await render(3)).toContain("13 | 14 UTM ZONE");
    const t4 = await render(4);
    expect(t4).toMatch(/13T [A-Z]{2}/);
    expect(t4).toMatch(/14T [A-Z]{2}/);
    expect(t4).toMatch(/· MGRS/);
  });

  it("[CONTROL] a page inside one zone has no junction label", async () => {
    const pdf = await renderTo({ tier: 3 });
    expect(measurePdfPages(pdf)[0]!.texts.join("")).not.toContain("UTM ZONE");
  });
});

describe("grid north per zone through renderAtlas", () => {
  it("[BEHAVIORAL] a tier-4 junction page gives each zone's grid north and G-M", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-gn-"));
    try {
      const out = join(dir, "a.pdf");
      await renderAtlas({ mode: "location", center: { lng: -102, lat: 40.8 }, scalePresetId: "usgs-7-5-min", tier: 4, declinationDate: "2026-07-02", outputPath: out });
      const texts = measurePdfPages(readFileSync(out))[0]!.texts;
      expect(texts.some((t) => /^MN .* · GN \d\.\d° E \(13\) \/ \d\.\d° W \(14\) of true N$/.test(t))).toBe(true);
      expect(texts.some((t) => /^G-M \d\.\d° [EW] \(13\) \/ \d\.\d° [EW] \(14\) · WMM2025/.test(t))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[BEHAVIORAL] worksheet rows name the grid to measure on when legs start in different zones", async () => {
    const pdf = await renderTo({
      mode: "location",
      locations: [{ center: { lng: -102.05, lat: 40.8 } }, { center: { lng: -101.95, lat: 40.8 } }, { center: { lng: -101.9, lat: 40.82 } }],
      worksheet: true, tier: 4,
      declinationDate: "2026-07-02",
      tableOfContents: false,
      overview: false,
    });
    const key = measurePdfPages(pdf).at(-1)!.texts.join(" ");
    expect(key).toContain("UTM 13 grid");
    expect(key).toContain("UTM 14 grid");
  });
});

describe("the polar UPS grid through renderAtlas", () => {
  it("[BEHAVIORAL] a tier-4 page north of 84°N is gridded in UPS and its diagram uses UPS grid north", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-ups-"));
    try {
      const out = join(dir, "a.pdf");
      await renderAtlas({ mode: "location", center: { lng: 10, lat: 84.5 }, scalePresetId: "usgs-7-5-min", tier: 4, declinationDate: "2026-07-02", outputPath: out });
      const texts = measurePdfPages(readFileSync(out))[0]!.texts.join("");
      expect(texts).toContain("Z · UPS (polar grid)");
      expect(texts).toMatch(/GN 10\.0° E \(UPS\) of true N/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("worksheet legs to landmarks and hand-picked legs through renderAtlas", () => {
  const STOPS = [
    { center: { lng: -96.7026, lat: 40.8136 }, label: "Capitol" },
    { center: { lng: -96.7116, lat: 40.8169 }, label: "Haymarket" },
    { center: { lng: -96.7734, lat: 40.7786 }, label: "Pioneers" },
  ];
  const LANDMARKS = [
    { lng: -96.7001, lat: 40.8152, name: "Water Tower", category: "tower", score: 5 }, // by the Capitol
    { lng: -96.7700, lat: 40.7770, name: "Nature Center", category: "building", score: 4 }, // by Pioneers
    { lng: -97.5, lat: 41.2, name: "Far Hill", category: "peak", score: 3 }, // on no page
  ];
  const keyOf = async (extra: Record<string, unknown>) => {
    const pdf = await renderTo({ mode: "location", locations: STOPS, landmarks: LANDMARKS, worksheet: true, tier: 4, declinationDate: "2026-07-02", tableOfContents: false, overview: false, ...extra });
    return measurePdfPages(pdf).at(-1)!.texts;
  };

  it("[BEHAVIORAL] hand-picked legs replace the consecutive list; ends are L# or a landmark's name", async () => {
    const key = await keyOf({ worksheetLegs: [{ from: "L1", to: "L3" }, { from: "l3", to: "nature center" }] });
    expect(key).toContain("L1 Capitol to L3 Pioneers");
    expect(key).toContain("L3 Pioneers to Nature Center");
    expect(key).not.toContain("L1 Capitol to L2 Haymarket");
  });

  it("[BEHAVIORAL] worksheetLandmarks adds legs from each stop to the landmarks on its own page", async () => {
    const key = await keyOf({ worksheetLandmarks: true });
    expect(key).toContain("L1 Capitol to L2 Haymarket"); // the default legs stay
    expect(key).toContain("L1 Capitol to Water Tower");
    expect(key).toContain("L3 Pioneers to Nature Center");
    expect(key.some((t) => t.includes("Far Hill"))).toBe(false);
  });

  it("refuses an unknown leg end before rendering, and the CLI flags reach the engine", async () => {
    await expect(renderTo({ mode: "location", locations: STOPS, worksheet: true, tier: 4, worksheetLegs: [{ from: "L1", to: "L9" }] })).rejects.toThrow(
      /Invalid worksheet leg end "L9": not a location \(L1–L3\)/,
    );
    await expect(renderTo({ mode: "location", locations: STOPS, worksheet: true, tier: 4, worksheetLegs: [{ from: "L1", to: "Nowhere" }] })).rejects.toThrow(
      /Invalid worksheet leg end "Nowhere"/,
    );
    expect(
      inputFromArgs(["--location", "-96.7,40.8", "--scale", "usgs-7-5-min", "--worksheet", "--worksheet-landmarks", "--worksheet-leg", "L1:L1", "--worksheet-leg", "L1:Water Tower"]),
    ).toMatchObject({ worksheetLandmarks: true, worksheetLegs: [{ from: "L1", to: "L1" }, { from: "L1", to: "Water Tower" }] });
  });
});

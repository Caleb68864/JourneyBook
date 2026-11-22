import {
  Document,
  Page,
  View,
  Text,
  Image,
  Svg,
  Rect,
  Line,
  Polygon,
  Circle,
  Path,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  LETTER_PORTRAIT_PT,
  mapBoxInches,
  niceScaleBar,
  PAGE_FURNITURE_PT as FURNITURE,
  POINTS_PER_INCH as PT,
  type AtlasContract,
  type AtlasOverview,
  type AtlasPage,
  type PageMargins,
  type PlacedLandmark,
  type ScalePreset,
  type ThreeNorths,
  type UsngGridOverlay,
  type WorksheetLeg,
  formatEastWest,
} from "@journeybook/atlas-core";
import { brand, PIN_SHAPES, resolvePinShape, resolvePinColor } from "@journeybook/ui";
import type { PinStyle } from "@journeybook/atlas-core";
import type { ReactNode } from "react";

// Brand token aliases for furniture styling — values come from @journeybook/ui/tokens.
const INK = brand.ink;
const FOREST = brand.forest;
const BARK = brand.bark;
const PARCHMENT = brand.parchment;

/**
 * Every fixed dimension below comes from atlas-core's PAGE_FURNITURE_PT, which
 * is also what `groundFootprintMeters` measures a page's ground bbox against.
 * Sharing the numbers is the point: the map panel takes the printable area less
 * this furniture, so the box the map is painted into is exactly the box its
 * bbox was sized from. Give a furniture block a height that its content can
 * outgrow and the panel silently shrinks — which is how the atlas came to print
 * ~30% off its stated scale — so each block is fixed-height, non-shrinking, and
 * its text is clamped to fit.
 */
/** Wide enough for a ladder range such as "100-102" at the label's 9 pt. */
const OVERVIEW_LABEL_WIDTH_PT = 36;

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: INK },
  neatline: {
    flexGrow: 1,
    borderWidth: FURNITURE.neatlineBorder,
    borderColor: BARK,
    padding: FURNITURE.neatlinePadding,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: FURNITURE.headerRow,
    flexShrink: 0,
  },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", color: FOREST },
  pageTitle: { fontSize: 9, color: INK, marginTop: 1 },
  pageId: { fontSize: 16, fontFamily: "Helvetica-Bold", color: FOREST },
  edgeLabel: { fontSize: 7, color: BARK, textAlign: "center" },
  edgeLabelRow: { fontSize: 7, color: BARK, textAlign: "center", height: FURNITURE.edgeLabelRow, flexShrink: 0 },
  // The map panel row is sized explicitly (see AtlasPageView) rather than left to
  // grow into whatever the furniture leaves over — that leftover is what varied
  // with title length, notes and tier, and varying it varies the printed scale.
  panelRow: { flexDirection: "row", flexShrink: 0, alignItems: "center" },
  panel: {
    flexGrow: 1,
    backgroundColor: PARCHMENT,
    borderWidth: FURNITURE.panelBorder,
    borderColor: BARK,
    alignItems: "center",
    justifyContent: "center",
  },
  /** The map panel of an atlas page: the exact printed map box, never flexed. */
  mapPanel: {
    backgroundColor: PARCHMENT,
    borderWidth: FURNITURE.panelBorder,
    borderColor: BARK,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 0,
    flexShrink: 0,
    position: "relative",
  },
  panelNote: { fontSize: 8, color: BARK },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: FURNITURE.footerRow,
    flexShrink: 0,
  },
  small: { fontSize: 7, color: INK },
  attribution: { fontSize: 6, color: BARK, maxWidth: 280 },
  /**
   * The page's statement of its own print resolution, under the calibration
   * tick. Deliberately in the tick's block and not the credit column: the credit
   * is caller-supplied and wraps, so a line stacked on top of it would be pushed
   * upward by a long attribution until it left the fixed footer row — and
   * @react-pdf paints an overflowing line anyway, silently. The tick's block is a
   * fixed 1-inch rule plus one fixed caption, so this line's distance from the
   * foot of the page does not depend on anything a caller can lengthen.
   */
  printResolution: { fontSize: 6, color: BARK, marginTop: 1 },
  /** Wraps the calibration tick and the resolution line into one centred block. */
  printCheck: { alignItems: "center" },
  // Locations table of contents (front-matter page).
  tocHeading: { fontSize: 11, fontFamily: "Helvetica-Bold", color: FOREST, marginTop: 10, marginBottom: 8 },
  tocRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingVertical: 3.5,
    borderBottomWidth: 0.5,
    borderBottomColor: BARK,
    borderStyle: "dotted",
  },
  pageNumber: { fontSize: 11, fontFamily: "Helvetica-Bold", color: FOREST, marginLeft: 8 },
  overviewPageLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK, textAlign: "center", width: OVERVIEW_LABEL_WIDTH_PT },
  // Alphanumeric reference-grid border labels (write the cell coordinate for notes).
  gridLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: INK,
    textAlign: "center",
    backgroundColor: "rgba(237,228,207,0.82)",
  },
  // Notes area at the foot of a page: saved notes + ruled blank lines for writing.
  // Fixed height (reserved whether or not notes are shown) so the map box — and
  // therefore the printed scale — is identical on every page of the atlas.
  notesArea: {
    height: FURNITURE.notesBlock,
    flexShrink: 0,
    borderTopWidth: 0.75,
    borderTopColor: BARK,
    paddingTop: 3,
  },
  notesHeader: { fontSize: 7, fontFamily: "Helvetica-Bold", color: BARK, letterSpacing: 1, marginBottom: 2 },
  notesText: { fontSize: 8, color: INK, marginBottom: 3 },
  notesLine: { borderBottomWidth: 0.5, borderBottomColor: BARK, height: 13 },
  tocLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: FOREST, width: 34 },
  tocName: { fontSize: 10, color: INK, flexGrow: 1, flexShrink: 1 },
  tocScale: { fontSize: 8, color: BARK, marginLeft: 8 },
  tocPage: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, marginLeft: 8 },
  // Per-page landmark legend, pinned in the panel corner; distinct from the
  // route/L# furniture (BARK diamond glyph, not a FOREST circle).
  landmarkLegend: {
    position: "absolute",
    top: 4,
    left: 4,
    maxWidth: 150,
    backgroundColor: PARCHMENT,
    borderWidth: 0.75,
    borderColor: BARK,
    padding: 3,
  },
  landmarkLegendTitle: { fontSize: 6, fontFamily: "Helvetica-Bold", color: BARK, marginBottom: 1 },
  landmarkLegendRow: { flexDirection: "row", alignItems: "center", marginTop: 1 },
  landmarkLegendName: { fontSize: 6, color: INK, marginLeft: 3 },
});

/**
 * The printed map box for a page, in points — the same box atlas-core sized the
 * page's ground bbox against. Every overlay is drawn in this coordinate space so
 * grid, route and landmark geometry lands on the basemap beneath it.
 */
/**
 * Clamp a furniture caption to a single line. Every furniture block is
 * fixed-height so the map box stays constant; text that wrapped would spill out
 * of its block instead of quietly shrinking the map.
 */
const CLAMP_ONE_LINE = { maxLines: 1, textOverflow: "ellipsis" } as const;

interface MapBox {
  /** Printed map width in points. */
  width: number;
  /** Printed map height in points. */
  height: number;
}

function mapBoxPoints(margins: PageMargins, orientation: AtlasPage["orientation"]): MapBox {
  const box = mapBoxInches({ widthIn: 8.5, heightIn: 11, orientation, margins });
  return { width: box.widthIn * PT, height: box.heightIn * PT };
}

/**
 * The overview page's own furniture, in points. It does not use the atlas pages'
 * margins or PAGE_FURNITURE_PT — no edge-label columns, no notes block, no
 * footer — so it needs its own two numbers, on the same discipline: fixed-height
 * blocks, and a map box that is computed rather than flexed.
 */
const OVERVIEW_FURNITURE_PT = {
  /** Sheet padding outside the neatline. */
  pagePadding: 0.75 * PT,
  /** The "N pages · numbers are PDF page numbers" caption under the panel. */
  captionRow: 12,
} as const;

/**
 * The overview page's map box in points — and, like every other map box in this
 * renderer, NOT a square.
 *
 * The overlay used to be drawn into a `viewBox="0 0 1000 1000"` over a panel
 * that is 487 x 625, so react-pdf's default `preserveAspectRatio="meet"`
 * letterboxed it: the page rectangles, the route and the stop markers were
 * uniformly scaled to the panel's smaller side and centred, landing off-register
 * against the basemap underneath — which was itself cropped by an
 * `objectFit: "cover"` the atlas pages had already dropped for the same reason.
 * An overview whose rectangles do not sit on the ground they name is worse than
 * no overview, because it is read as a map. Computing the box lets `OverlaySvg`
 * put the overlay in the same coordinate space as the image, as on every other
 * page in the document.
 */
function overviewBoxPoints(): MapBox {
  const outer =
    2 *
    (OVERVIEW_FURNITURE_PT.pagePadding +
      FURNITURE.neatlineBorder +
      FURNITURE.neatlinePadding +
      FURNITURE.panelBorder);
  return {
    width: LETTER_PORTRAIT_PT.width - outer,
    height:
      LETTER_PORTRAIT_PT.height - outer - FURNITURE.headerRow - OVERVIEW_FURNITURE_PT.captionRow,
  };
}

/**
 * The shared coordinate space for every vector overlay drawn over the map.
 *
 * The viewBox is the map box in points, NOT a square: react-pdf defaults to
 * `preserveAspectRatio="meet"`, so a square viewBox on a taller-than-wide panel
 * letterboxes the overlay and shifts every line, marker and label away from the
 * feature it marks on the basemap underneath. Overlay geometry arrives
 * normalized (0..1), so callers scale x by `box.width` and y by `box.height`.
 */
function OverlaySvg({ box, children }: { box: MapBox; children: ReactNode }) {
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${box.width} ${box.height}`}>
        {children}
      </Svg>
    </View>
  );
}

/** A true-length scale bar (drawn only at tier >= 2). */
function ScaleBar({ scale, maxInches }: { scale: ScalePreset; maxInches: number }) {
  const bar = niceScaleBar(scale, maxInches);
  const w = bar.inches * PT;
  const seg = w / 4;
  return (
    <View>
      <Svg width={w} height={7}>
        <Rect x={0} y={0} width={w} height={6} stroke={INK} strokeWidth={0.75} fill="none" />
        {[0, 1, 2, 3].map((i) =>
          i % 2 === 0 ? <Rect key={i} x={i * seg} y={0} width={seg} height={6} fill={INK} /> : null,
        )}
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", width: w }}>
        <Text style={styles.small}>0</Text>
        <Text style={styles.small}>{bar.label}</Text>
      </View>
    </View>
  );
}

/** A north-up compass rose (drawn only at tier >= 2). */
function CompassRose() {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={[styles.small, { fontFamily: "Helvetica-Bold" }]}>N</Text>
      <Svg width={26} height={26}>
        <Circle cx={13} cy={13} r={11} stroke={BARK} strokeWidth={1} fill="none" />
        <Polygon points="13,2 16,13 13,11 10,13" fill={FOREST} />
        <Polygon points="13,24 10,13 13,15 16,13" fill={BARK} />
        <Circle cx={13} cy={13} r={1.4} fill={INK} />
      </Svg>
    </View>
  );
}

/** What a tier-4 page knows about its norths: the figures, or why there are none. */
export type PageNorths = ThreeNorths | { unavailable: string };

/**
 * Display angles for the declination diagram, in degrees from the vertical (true north).
 * Declination diagrams are conventionally drawn not to scale (the angles are often a degree or
 * two), so only the ORDER is kept: each of grid and magnetic north sits on its true side of true
 * north, and the one nearer true north is drawn nearer it. The exact figures are printed beside.
 */
export function diagramAngles(gridConvergence: number, declination: number): { grid: number; magnetic: number } {
  const side = (v: number) => (v >= 0 ? 1 : -1);
  if (side(gridConvergence) !== side(declination)) {
    return { grid: side(gridConvergence) * 14, magnetic: side(declination) * 14 };
  }
  return Math.abs(gridConvergence) <= Math.abs(declination)
    ? { grid: side(gridConvergence) * 10, magnetic: side(declination) * 24 }
    : { grid: side(gridConvergence) * 24, magnetic: side(declination) * 10 };
}

/** The caption lines printed beside the declination diagram. */
export function northsCaption(n: ThreeNorths): [string, string] {
  const rate = n.declinationPerYear;
  const drift = Math.abs(rate) < 0.05 ? "steady" : `MN moves ${formatEastWest(rate)}/yr`;
  return [
    `MN ${formatEastWest(n.declination)} · GN ${formatEastWest(n.gridConvergence)} (UTM ${n.utmZone}) of true N`,
    `G-M ${formatEastWest(n.gmAngle)} · ${n.model} ${n.year.toFixed(1)} · ${drift}`,
  ];
}

/**
 * Tier 4's declination diagram (Stage 6B Level 4), in the compass rose's place: true north
 * (star), grid north (GN) and magnetic north (MN, half arrow) from one point, not to scale, with
 * the measured angles and the G-M angle beside it. Without figures (the model does not cover
 * the date) it says so instead of drawing a diagram of nothing.
 */
function DeclinationDiagram({ norths }: { norths: PageNorths }) {
  if ("unavailable" in norths) {
    // One clamped line, no width cap: a cap cut "…2025.0 to 2030.0" off mid-sentence.
    return <Text style={[styles.printResolution, CLAMP_ONE_LINE]}>{norths.unavailable}</Text>;
  }
  const { grid, magnetic } = diagramAngles(norths.gridConvergence, norths.declination);
  const len = 22;
  const cx = 14;
  const cy = 26;
  const tip = (deg: number) => [cx + len * Math.sin((deg * Math.PI) / 180), cy - len * Math.cos((deg * Math.PI) / 180)] as const;
  const [gx, gy] = tip(grid);
  const [mx, my] = tip(magnetic);
  const [line1, line2] = northsCaption(norths);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Svg width={28} height={28}>
        <Line x1={cx} y1={cy} x2={cx} y2={cy - len} stroke={INK} strokeWidth={0.75} />
        <Polygon points={`${cx},${cy - len - 3} ${cx + 1},${cy - len} ${cx - 1},${cy - len}`} fill={INK} />
        <Line x1={cx} y1={cy} x2={gx} y2={gy} stroke={BARK} strokeWidth={0.75} />
        <Line x1={cx} y1={cy} x2={mx} y2={my} stroke={FOREST} strokeWidth={0.75} />
        <Polygon points={`${mx},${my} ${cx + (mx - cx) * 0.8},${cy + (my - cy) * 0.8} ${cx + (mx - cx) * 0.8 + 2},${cy + (my - cy) * 0.8}`} fill={FOREST} />
      </Svg>
      <View style={{ marginLeft: 3 }}>
        <Text style={[styles.printResolution, CLAMP_ONE_LINE]}>{line1}</Text>
        <Text style={[styles.printResolution, CLAMP_ONE_LINE]}>{line2}</Text>
        <Text style={[styles.printResolution, CLAMP_ONE_LINE]}>Declination diagram not to scale</Text>
      </View>
    </View>
  );
}

/** An exactly-1-inch tick so a printed page reveals any printer scaling. */
function CalibrationTick() {
  const w = PT; // 72 pt = 1 inch
  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={w} height={6}>
        <Line x1={0} y1={3} x2={w} y2={3} stroke={INK} strokeWidth={0.75} />
        <Line x1={0} y1={0} x2={0} y2={6} stroke={INK} strokeWidth={0.75} />
        <Line x1={w} y1={0} x2={w} y2={6} stroke={INK} strokeWidth={0.75} />
      </Svg>
      <Text style={styles.small}>1 in · print check</Text>
    </View>
  );
}

function continuation(dir: string, id: string | undefined) {
  return id ? `CONTINUE ${dir} · ${id}` : "";
}

/**
 * What one sheet says about the resolution it was printed at.
 *
 * The app knows this twice over — the scale picker says what a preset *would*
 * deliver on a reference page, and the render history says what a finished atlas
 * *did* deliver — and the printed page, which is the artefact someone actually
 * navigates from and is usually detached from the app that made it, said
 * nothing. `render-cli` measures the delivered resolution PER PANEL against the
 * same map box the request was sized from, so a page can state its own figure
 * rather than the book's range; in a zoom ladder the two are very different
 * numbers.
 *
 * Only this. The scale is already on the page as a true-length bar, the source
 * is already on it as a credit line, and the tick above this caption already
 * proves the printer did not rescale the sheet. What was missing is the one
 * thing a reader cannot recover by looking: whether a label that reads soft is
 * soft in the source or soft because this page was delivered at half the
 * resolution it asked for. That is actionable — re-render, or accept it — and a
 * whole-number DPI is enough to act on. A date, a preset id or a tile zoom would
 * be furniture nobody can do anything with.
 *
 * THREE ANSWERS, kept apart, exactly as the render history keeps them
 * (`no-basemap` vs `not-recorded` in `apps/web/src/lib/pdf-history.ts`): a page
 * drawn with no basemap has no resolution to report, a page drawn WITH one whose
 * figure never reached the renderer has a missing measurement, and these are
 * different facts about the sheet in your hand. Neither may print as a number,
 * and neither may print as silence.
 */
export function printResolutionCaption(dpi: number | undefined, basemapDrawn: boolean): string {
  if (!basemapDrawn) return "print resolution · no basemap drawn";
  if (typeof dpi !== "number" || !Number.isFinite(dpi) || dpi <= 0) {
    return "print resolution · not recorded";
  }
  // Whole DPI, rounded once — the same convention as the render history and the
  // generated print-resolution table, so the figure on the paper and the figure
  // on the screen are the same kind of number.
  return `print resolution · ${Math.round(dpi)} dpi`;
}

/**
 * Per-page route furniture for a corridor (R#) page. Geometry is expressed in
 * normalized panel coordinates (0..1, origin top-left) so it maps onto the same
 * 1000×1000 viewBox the map panel/grid use. Keyed by `page.id` in the `routes`
 * map exactly like `panels`/`grids`, so the core `AtlasContract`/`AtlasPage`
 * types stay untouched — the overlay is purely additive.
 */
export interface RouteOverlay {
  /** Normalized (0..1) polyline vertices tracing the route across this page. */
  points: { x: number; y: number }[];
  /** Normalized (0..1) stop-marker centres for stops that fall on/near this page. */
  stops?: { x: number; y: number; label?: string }[];
}

/**
 * SVG route overlay for a corridor page, drawn over the map panel: a thin,
 * print-friendly polyline (light casing under a dark stroke) plus stop markers.
 * Built from the already-imported Svg/Line/Circle primitives.
 */
function RouteLayer({ overlay, box }: { overlay: RouteOverlay; box: MapBox }) {
  const segments = overlay.points.reduce<{ a: { x: number; y: number }; b: { x: number; y: number } }[]>(
    (acc, b, i) => {
      const a = overlay.points[i - 1];
      if (i > 0 && a) acc.push({ a, b });
      return acc;
    },
    [],
  );
  return (
    <OverlaySvg box={box}>
      {/* Light casing drawn under the dark stroke so the route reads over any basemap. */}
      {segments.map((s, i) => (
        <Line
          key={`casing-${i}`}
          x1={s.a.x * box.width}
          y1={s.a.y * box.height}
          x2={s.b.x * box.width}
          y2={s.b.y * box.height}
          stroke={PARCHMENT}
          strokeOpacity={0.95}
          strokeWidth={4}
        />
      ))}
      {/* Dark route stroke on top. */}
      {segments.map((s, i) => (
        <Line
          key={`route-${i}`}
          x1={s.a.x * box.width}
          y1={s.a.y * box.height}
          x2={s.b.x * box.width}
          y2={s.b.y * box.height}
          stroke={INK}
          strokeWidth={1.7}
        />
      ))}
      {/* Stop markers where a stop lands on/near this page. */}
      {(overlay.stops ?? []).map((stop, i) => (
        <Circle
          key={`stop-${i}`}
          cx={stop.x * box.width}
          cy={stop.y * box.height}
          r={4.5}
          fill={FOREST}
          stroke={PARCHMENT}
          strokeWidth={1.25}
        />
      ))}
    </OverlaySvg>
  );
}

const GRID_COLS = 6;
const GRID_ROWS = 8;
const GRID_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

/**
 * Alphanumeric reference-grid border over the map panel: faint cell lines plus
 * column letters (A…) along the top and row numbers (1…) down the left, so a
 * reader can note a feature's grid cell (e.g. "C4") when writing on the page.
 */
function ReferenceGrid({ box }: { box: MapBox }) {
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <OverlaySvg box={box}>
        {Array.from({ length: GRID_COLS - 1 }, (_, i) => (
          <Line key={`gv${i}`} x1={((i + 1) * box.width) / GRID_COLS} y1={0} x2={((i + 1) * box.width) / GRID_COLS} y2={box.height} stroke={BARK} strokeOpacity={0.28} strokeWidth={0.5} />
        ))}
        {Array.from({ length: GRID_ROWS - 1 }, (_, j) => (
          <Line key={`gh${j}`} x1={0} y1={((j + 1) * box.height) / GRID_ROWS} x2={box.width} y2={((j + 1) * box.height) / GRID_ROWS} stroke={BARK} strokeOpacity={0.28} strokeWidth={0.5} />
        ))}
      </OverlaySvg>
      {Array.from({ length: GRID_COLS }, (_, i) => (
        <View key={`gl${i}`} style={{ position: "absolute", top: 1, left: `${((i + 0.5) * 100) / GRID_COLS}%`, marginLeft: -7, width: 14 }}>
          <Text style={styles.gridLabel}>{GRID_LETTERS[i]}</Text>
        </View>
      ))}
      {Array.from({ length: GRID_ROWS }, (_, j) => (
        <View key={`gn${j}`} style={{ position: "absolute", left: 1, top: `${((j + 0.5) * 100) / GRID_ROWS}%`, marginTop: -5, width: 12 }}>
          <Text style={styles.gridLabel}>{j + 1}</Text>
        </View>
      ))}
    </View>
  );
}

/** Crop-mark geometry, in points: each tick's length and its gap from the map box corner. */
export const CROP_MARK = { length: 8, gap: 2, stroke: 0.5 } as const;

/**
 * Crop marks at the four corners of the printed map box (Stage 1D, off by default).
 *
 * Two ticks per corner, on the lines of the map box's edges, starting `gap` outside it, so a
 * sheet can be trimmed to exactly its map and butted against its neighbour. They sit in the
 * space the furniture already reserves round the panel (the edge-label column and row; the
 * CONTINUE labels are centred, so the corners are empty) and never inside the map box, so
 * turning them on cannot move the box or its printed scale.
 *
 * Drawn from inside the panel's own View, positioned past its 1 pt border, so they follow the
 * box wherever the furniture puts it.
 */
function CropMarks({ box }: { box: MapBox }) {
  const { length, gap, stroke } = CROP_MARK;
  const half = stroke / 2;
  // Positions relative to the map box's top-left (this View's content box). Each tick is a thin
  // filled bar, centred on the edge line it extends. Bars, not an SVG: an SVG brings a viewport
  // rectangle larger than the map box, and the map box is found on the page as its largest
  // rectangle (`mapBoxOf`, which the print-fidelity checks measure scale against).
  const right = box.width;
  const bottom = box.height;
  const bars: { left: number; top: number; width: number; height: number }[] = [
    { left: -gap - length, top: -half, width: length, height: stroke },
    { left: -half, top: -gap - length, width: stroke, height: length },
    { left: right + gap, top: -half, width: length, height: stroke },
    { left: right - half, top: -gap - length, width: stroke, height: length },
    { left: -gap - length, top: bottom - half, width: length, height: stroke },
    { left: -half, top: bottom + gap, width: stroke, height: length },
    { left: right + gap, top: bottom - half, width: length, height: stroke },
    { left: right - half, top: bottom + gap, width: stroke, height: length },
  ];
  return (
    <>
      {bars.map((bar, i) => (
        <View key={i} style={{ position: "absolute", ...bar, backgroundColor: INK }} />
      ))}
    </>
  );
}

/** One page's rectangle in the locator inset, in points from the inset's top-left. */
export interface LocatorCell {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  current: boolean;
}

/**
 * The grid-locator inset's layout: every page of the atlas as a rectangle, scaled to fit
 * `maxWidth` × `maxHeight` points with the atlas's own proportions (degrees, with longitude
 * shrunk by cos(latitude) so a square of ground looks square), north up. A sketch for finding
 * your place, not a measured map. Null for a one-page atlas, which has nothing to locate.
 */
export function locatorInsetLayout(
  pages: readonly Pick<AtlasPage, "id" | "bbox">[],
  currentId: string,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number; cells: LocatorCell[] } | null {
  if (pages.length < 2) return null;
  const west = Math.min(...pages.map((p) => p.bbox[0]));
  const south = Math.min(...pages.map((p) => p.bbox[1]));
  const east = Math.max(...pages.map((p) => p.bbox[2]));
  const north = Math.max(...pages.map((p) => p.bbox[3]));
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const spanX = (east - west) * k;
  const spanY = north - south;
  const scale = Math.min(maxWidth / spanX, maxHeight / spanY);
  return {
    width: spanX * scale,
    height: spanY * scale,
    cells: pages.map((p) => ({
      id: p.id,
      x: (p.bbox[0] - west) * k * scale,
      y: (north - p.bbox[3]) * scale,
      width: (p.bbox[2] - p.bbox[0]) * k * scale,
      height: (p.bbox[3] - p.bbox[1]) * scale,
      current: p.id === currentId,
    })),
  };
}

/** Largest size of the locator inset, in points: about an inch, in the map's lower-right corner. */
export const LOCATOR_INSET_MAX = { width: 72, height: 72, inset: 6 } as const;

/**
 * The grid-locator inset (Stage 1D, off by default): the whole atlas in miniature, this page
 * filled, in the lower-right corner OF the map. Drawn over the map rather than beside it, so the
 * map box, and with it the printed scale, is the same with it on or off; the cost is the
 * square inch of map it covers, which is why it is opt-in.
 */
function LocatorInset({ contract, page, box }: { contract: AtlasContract; page: AtlasPage; box: MapBox }) {
  const layout = locatorInsetLayout(contract.pages, page.id, LOCATOR_INSET_MAX.width, LOCATOR_INSET_MAX.height);
  if (!layout) return null;
  const pad = 2;
  const w = layout.width + 2 * pad;
  const h = layout.height + 2 * pad;
  return (
    <View
      style={{
        position: "absolute",
        left: box.width - w - LOCATOR_INSET_MAX.inset,
        top: box.height - h - LOCATOR_INSET_MAX.inset,
        width: w,
        height: h,
      }}
    >
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <Rect x={0} y={0} width={w} height={h} fill={PARCHMENT} stroke={BARK} strokeWidth={0.5} />
        {layout.cells.map((c) => (
          <Rect
            key={c.id}
            x={pad + c.x}
            y={pad + c.y}
            width={c.width}
            height={c.height}
            fill={c.current ? FOREST : PARCHMENT}
            stroke={BARK}
            strokeWidth={0.4}
          />
        ))}
      </Svg>
    </View>
  );
}

/** Foot-of-page notes: any saved location note, then ruled blank lines for writing. */
function NotesArea({ notes }: { notes?: string }) {
  return (
    <View style={styles.notesArea}>
      <Text style={styles.notesHeader}>NOTES</Text>
      {/* Clamped: the notes block has a fixed height so it cannot eat the map. */}
      {notes ? (
        <Text style={[styles.notesText, CLAMP_ONE_LINE]}>{notes}</Text>
      ) : null}
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.notesLine} />
      ))}
    </View>
  );
}

/**
 * A custom location pin (shared shape set + color) drawn over a panel, anchored so
 * the shape's point sits on (leftPct, topPct). The L# label is centered on the
 * shape. Used for the location-page centre pin and the overview's stop markers.
 */
function LocationPin({
  pin,
  label,
  leftPct,
  topPct,
  size = 30,
}: {
  pin?: PinStyle;
  label: string;
  leftPct: number;
  topPct: number;
  size?: number;
}) {
  const def = PIN_SHAPES[resolvePinShape(pin?.shape)];
  const fill = resolvePinColor(pin?.color);
  const sc = size / 24;
  const [ax, ay] = def.anchor;
  const [lx, ly] = def.labelAt;
  return (
    <View
      style={{
        position: "absolute",
        left: `${leftPct}%`,
        top: `${topPct}%`,
        marginLeft: -ax * sc,
        marginTop: -ay * sc,
        width: size,
        height: size,
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={def.path} fill={fill} stroke={PARCHMENT} strokeWidth={1.2} />
      </Svg>
      <Text
        style={{
          position: "absolute",
          left: lx * sc - 9,
          top: ly * sc - 4.5,
          width: 18,
          textAlign: "center",
          fontSize: size * 0.26,
          fontFamily: "Helvetica-Bold",
          color: "#ffffff",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * SVG grid overlay for a USNG/tier-3 page, drawn over the map panel: the grid
 * lines plus the principal-digit easting/northing labels along all four edges.
 *
 * The labels are the point of a USNG grid — without them the lines are
 * decoration you cannot read a grid reference off, which is exactly what a
 * Tier 3 "Navigator" page is for. `buildUsngGrid` has always returned them on
 * `overlay.labels`; they are drawn here in the same map-box coordinate space as
 * the lines, nudged inside the neatline so they sit on the map, not off it.
 */
function UsngGridLayer({ overlay, box }: { overlay: UsngGridOverlay; box: MapBox }) {
  const FONT = 6;
  // Keep a label fully inside the map box: the edge it belongs to decides
  // whether it is pushed in from the top/bottom or the left/right.
  const place = (label: UsngGridOverlay["labels"][number]) => {
    const x = label.x * box.width;
    const y = label.y * box.height;
    switch (label.edge) {
      case "top":
        return { x, y: FONT + 1.5, anchor: "middle" as const };
      case "bottom":
        return { x, y: box.height - 2.5, anchor: "middle" as const };
      case "left":
        return { x: 2, y: Math.min(Math.max(y, FONT + 1.5), box.height - 2.5), anchor: "start" as const };
      default:
        return { x: box.width - 2, y: Math.min(Math.max(y, FONT + 1.5), box.height - 2.5), anchor: "end" as const };
    }
  };
  return (
    <OverlaySvg box={box}>
      {overlay.lines.map((line, i) => (
        <Line
          key={i}
          x1={line.x1 * box.width}
          y1={line.y1 * box.height}
          x2={line.x2 * box.width}
          y2={line.y2 * box.height}
          stroke={FOREST}
          strokeOpacity={0.45}
          strokeWidth={0.85}
        />
      ))}
      {overlay.labels.map((label, i) => {
        const at = place(label);
        return (
          <Text
            key={`usng-${i}`}
            x={at.x}
            y={at.y}
            textAnchor={at.anchor}
            style={{ fontSize: FONT, fontFamily: "Helvetica-Bold", fill: FOREST }}
          >
            {label.text}
          </Text>
        );
      })}
      {/* Level 4: each 100 km square's identifier inside its own part of the map, the way a
          military map prints it, so a reference can be written in full from either side of a
          square boundary. */}
      {(overlay.mgrs?.squares ?? []).map((sq, i) => (
        <Text
          key={`mgrs-sq-${i}`}
          x={sq.x * box.width + 3}
          y={sq.y * box.height - 3}
          textAnchor="start"
          style={{ fontSize: 8, fontFamily: "Helvetica-Bold", fill: INK }}
        >
          {sq.id}
        </Text>
      ))}
    </OverlaySvg>
  );
}

/** USNG collar badge shown in the tier-3 footer. */
function UsngCollar({ collar }: { collar: UsngGridOverlay["collar"] }) {
  if (!collar.zoneDesignator && !collar.hundredKmSquare) return null;
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={[styles.small, { fontFamily: "Helvetica-Bold" }, CLAMP_ONE_LINE]}>
        {collar.squares && collar.squares.length > 0
          ? `${collar.squares.join(" / ")} · MGRS`
          : `${collar.zoneDesignator} ${collar.hundredKmSquare} · USNG`}
      </Text>
    </View>
  );
}

/**
 * A diamond glyph centred at (cx, cy) with the given half-extent. Used for
 * landmark markers and the legend swatch so they stay visually DISTINCT from
 * the FOREST route-stop / L# circle markers — different shape (diamond, not
 * circle) and different colour (BARK fill, not FOREST).
 */
function landmarkDiamond(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

/**
 * SVG landmark overlay drawn over the map panel: a category diamond marker per
 * landmark plus a small label for markers whose label survived decluttering
 * (`labelPlaced`). Coordinates are normalized (0..1) over the same map-box
 * viewBox as RouteLayer/UsngGridLayer. Additive furniture keyed by `page.id`,
 * so the core AtlasContract/AtlasPage types stay untouched.
 */
function LandmarkLayer({ landmarks, box }: { landmarks: PlacedLandmark[]; box: MapBox }) {
  return (
    <OverlaySvg box={box}>
      {landmarks.map((lm, i) => (
        <Polygon
          key={`landmark-${i}`}
          points={landmarkDiamond(lm.x * box.width, lm.y * box.height, 5.4)}
          fill={BARK}
          stroke={PARCHMENT}
          strokeWidth={1.25}
        />
      ))}
      {landmarks.map((lm, i) =>
        lm.labelPlaced ? (
          <Text
            key={`landmark-label-${i}`}
            x={lm.x * box.width + 7}
            y={lm.y * box.height + 2}
            style={{ fontSize: 6.5, fill: INK }}
          >
            {lm.name}
          </Text>
        ) : null,
      )}
    </OverlaySvg>
  );
}

/**
 * Per-page landmark legend, pinned in the panel corner. Lists every landmark
 * selected for this page beside the same BARK diamond glyph the markers use —
 * distinct in presentation from the route/L# furniture.
 */
function LandmarkLegend({ landmarks }: { landmarks: PlacedLandmark[] }) {
  return (
    <View style={styles.landmarkLegend}>
      <Text style={styles.landmarkLegendTitle}>LANDMARKS</Text>
      {landmarks.map((lm, i) => (
        <View key={`legend-${i}`} style={styles.landmarkLegendRow}>
          <Svg width={8} height={8}>
            <Polygon points={landmarkDiamond(4, 4, 3.5)} fill={BARK} stroke={PARCHMENT} strokeWidth={0.75} />
          </Svg>
          <Text style={styles.landmarkLegendName}>
            {lm.name}
            {lm.category ? ` · ${lm.category}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

function AtlasPageView({
  page,
  contract,
  title,
  panel,
  grid,
  route,
  landmarks,
  pageNumber,
  referenceGrid,
  notes,
  attribution,
  printDpi,
  cropMarks,
  locatorInset,
  norths,
}: {
  page: AtlasPage;
  contract: AtlasContract;
  title: string;
  panel?: string;
  grid?: UsngGridOverlay;
  route?: RouteOverlay;
  landmarks?: PlacedLandmark[];
  /** Physical PDF page number (front matter included), printed in the footer. */
  pageNumber?: number;
  /** Draw the alphanumeric reference-grid border over the panel. */
  referenceGrid?: boolean;
  /** Show the foot-of-page notes area (saved notes + ruled lines). */
  notes?: boolean;
  /** Credit line for the tiles this page's panel was built from. */
  attribution?: string;
  /** Resolution this page's panel was delivered at, as the renderer measured it. */
  printDpi?: number;
  /** Crop marks at the map box corners. Default off. */
  cropMarks?: boolean;
  /** Grid-locator inset over the map's lower-right corner. Default off. */
  locatorInset?: boolean;
  /** Tier 4: this page's three norths (or why there are none) for the declination diagram. */
  norths?: PageNorths;
}) {
  const showTier2 = page.tier >= 2;
  const showTier4 = page.tier >= 4 && norths !== undefined;
  const showTier3 = page.tier >= 3;
  // The map box, not the printable area: a scale bar is measured against the
  // paper the map actually covers.
  const box = mapBoxPoints(contract.margins, page.orientation);
  const maxBarInches = (box.width / PT) * 0.45;
  const { gutter = 0 } = contract.margins;

  return (
    <Page
      size="LETTER"
      orientation={page.orientation === "landscape" ? "landscape" : "portrait"}
      style={[
        styles.page,
        {
          paddingTop: contract.margins.top * PT,
          paddingBottom: contract.margins.bottom * PT,
          paddingLeft: (contract.margins.left + gutter) * PT,
          paddingRight: contract.margins.right * PT,
        },
      ]}
    >
      <View style={styles.neatline}>
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            {/* Clamped to one line each: a title that wrapped used to steal height
                from the map panel, printing that page at a different scale. */}
            <Text style={[styles.title, CLAMP_ONE_LINE]}>{title}</Text>
            {/* A location page names its place and, when zoomed, its own scale. */}
            {page.title ? (
              <Text style={[styles.pageTitle, CLAMP_ONE_LINE]}>
                {page.title}
                {page.scale && page.scale.id !== contract.scale.id ? `  ·  ${page.scale.label}` : ""}
              </Text>
            ) : null}
          </View>
          <Text style={styles.pageId}>{page.id}</Text>
        </View>

        <Text style={styles.edgeLabelRow}>{continuation("NORTH", page.neighbors.north)}</Text>

        <View style={[styles.panelRow, { height: box.height + 2 * FURNITURE.panelBorder }]}>
          <Text style={[styles.edgeLabel, { width: FURNITURE.edgeLabelColumn, alignSelf: "center" }]}>
            {continuation("WEST", page.neighbors.west)}
          </Text>
          <View
            style={[
              styles.mapPanel,
              { width: box.width + 2 * FURNITURE.panelBorder, height: box.height + 2 * FURNITURE.panelBorder },
            ]}
          >
            {/* One geometry for every tier: the panel image is already cropped to
                the page bbox, so it fills the box exactly. `objectFit: "cover"`
                would scale it to the box's larger side and crop the map away. */}
            {panel ? (
              <Image src={panel} style={{ width: "100%", height: "100%" }} />
            ) : (
              <Text style={styles.panelNote}>map panel — pass --basemap to render</Text>
            )}
            {showTier3 && grid ? <UsngGridLayer overlay={grid} box={box} /> : null}
            {/* Route furniture is additive and only present for corridor (R#) pages.
                Dispatching on the id prefix is sound because atlas-core reserves the
                letters L and R out of the grid row alphabet (see ROW_LETTERS in
                grid.ts) — a grid page can never be named "R1". */}
            {route && page.id.startsWith("R") ? <RouteLayer overlay={route} box={box} /> : null}
            {/* Landmark furniture is additive, keyed by page.id like routes/grids. */}
            {landmarks && landmarks.length > 0 ? <LandmarkLayer landmarks={landmarks} box={box} /> : null}
            {landmarks && landmarks.length > 0 ? <LandmarkLegend landmarks={landmarks} /> : null}
            {/* Alphanumeric reference grid for writing cell coordinates. */}
            {referenceGrid ? <ReferenceGrid box={box} /> : null}
            {/* A location (L#) page is centred on its location → mark it with the pin.
                Safe for the same reason as the R# test above: L is reserved out of
                the grid row alphabet, so no plain grid page can claim a centre pin. */}
            {page.id.startsWith("L") ? (
              <LocationPin pin={page.pin} label={page.id} leftPct={50} topPct={50} size={34} />
            ) : null}
            {locatorInset ? <LocatorInset contract={contract} page={page} box={box} /> : null}
            {cropMarks ? <CropMarks box={box} /> : null}
          </View>
          <Text style={[styles.edgeLabel, { width: FURNITURE.edgeLabelColumn, alignSelf: "center" }]}>
            {continuation("EAST", page.neighbors.east)}
          </Text>
        </View>

        <Text style={styles.edgeLabelRow}>{continuation("SOUTH", page.neighbors.south)}</Text>

        {/* The notes block is reserved whether or not it is drawn, so turning
            notes off cannot change the map box (and with it the printed scale). */}
        {notes ? (
          <NotesArea notes={page.notes} />
        ) : (
          <View style={{ height: FURNITURE.notesBlock, flexShrink: 0 }} />
        )}

        {/* Absorbs any slack between the furniture allowances and what the
            furniture actually measures, keeping the footer on the neatline. */}
        <View style={{ flexGrow: 1 }} />

        <View style={styles.footer}>
          <View>
            {showTier2 ? <ScaleBar scale={page.scale ?? contract.scale} maxInches={maxBarInches} /> : null}
            {/* The credit for the tiles ACTUALLY used, resolved by map-sources from
                the tile proxy's X-Tile-Attribution header (or the basemap's own
                declared attribution) and threaded through render-cli. This was a
                hardcoded string naming two sources regardless of which one — if
                either — the page was drawn from, which is a licensing problem in
                both directions: it under-credits a source we did use and falsely
                credits one we did not. With no basemap there is no map data to
                credit, so only the product is named. */}
            <Text style={styles.attribution}>
              {attribution ? `${attribution} — Journey Book` : "Journey Book"}
            </Text>
          </View>
          <View style={styles.printCheck}>
            <CalibrationTick />
            {/* Clamped like every other furniture caption: the footer is a fixed
                40 pt row, and a caption that wrapped would be painted outside it
                (or clipped) without anything failing. `printResolution.test.ts`
                measures the baseline off the produced PDF for exactly this. */}
            <Text style={[styles.printResolution, CLAMP_ONE_LINE]}>
              {printResolutionCaption(printDpi, panel !== undefined)}
            </Text>
          </View>
          {showTier4 ? <DeclinationDiagram norths={norths!} /> : showTier2 ? <CompassRose /> : null}
          {showTier3 && grid ? <UsngCollar collar={grid.collar} /> : null}
          {pageNumber !== undefined ? (
            <Text style={styles.pageNumber}>{pageNumber}</Text>
          ) : null}
        </View>
      </View>
    </Page>
  );
}

/**
 * The book's title page, from `vault/branding-theme.md`'s cover structure: product,
 * adventure title, explorer name, date. Printed only when the user gave a name or a
 * date; an atlas without them starts where it always has.
 */
function TitlePage({ title, explorerName, atlasDate }: { title: string; explorerName?: string; atlasDate?: string }) {
  return (
    <Page size="LETTER" orientation="portrait" style={[styles.page, { justifyContent: "center", alignItems: "center" }]}>
      <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: FOREST, letterSpacing: 3 }}>JOURNEY BOOK</Text>
      <Text style={{ fontSize: 30, fontFamily: "Helvetica-Bold", color: INK, marginTop: 18, textAlign: "center" }}>{title}</Text>
      {explorerName ? (
        <Text style={{ fontSize: 16, color: INK, marginTop: 36, textAlign: "center" }}>{`Explorer: ${explorerName}`}</Text>
      ) : null}
      {atlasDate ? (
        <Text style={{ fontSize: 12, color: BARK, marginTop: 10, textAlign: "center" }}>{atlasDate}</Text>
      ) : null}
    </Page>
  );
}

/** One page-number label on the overview: normalized position and printed text. */
export interface OverviewPageLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** `L1a` → `L1`: the location a zoom-ladder page belongs to; undefined for any other page. */
function ladderLocation(pageId: string): string | undefined {
  return /^(L\d+)[a-z]+$/.exec(pageId)?.[1];
}

/** "4-6" for consecutive pages, "4, 9" otherwise, so a range never claims a page it lacks. */
function pageNumberText(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
  return consecutive && sorted.length > 1
    ? `${sorted[0]}-${sorted[sorted.length - 1]}`
    : sorted.join(", ");
}

/** How far below a footprint's top edge a ladder label sits: about 12 pt of the overview's 625 pt map box. */
const OVERVIEW_LADDER_LABEL_INSET = 0.02;

/**
 * The overview's page-number labels. A zoom ladder's footprints are nested around one
 * location, so a number per rectangle stacks them on the same spot; the ladder gets one
 * label on its largest footprint, with its page range. Every other page keeps its own.
 */
export function overviewPageLabels(
  pages: AtlasOverview["pages"],
  pageNumbers: Record<string, number>,
): OverviewPageLabel[] {
  const ladders = new Map<string, AtlasOverview["pages"]>();
  for (const page of pages) {
    const location = ladderLocation(page.id);
    if (location) ladders.set(location, [...(ladders.get(location) ?? []), page]);
  }

  const labels: OverviewPageLabel[] = [];
  const labelled = new Set<string>();
  for (const page of pages) {
    const location = ladderLocation(page.id);
    if (location && labelled.has(location)) continue;
    if (location) labelled.add(location);
    const group = location ? ladders.get(location)! : [page];
    const largest = group.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    labels.push({
      id: largest.id,
      x: largest.x + largest.w / 2,
      // A ladder's centre is its location's pin, so its label sits inside the top edge.
      y: location ? largest.y + OVERVIEW_LADDER_LABEL_INSET : largest.y + largest.h / 2,
      text: pageNumberText(group.flatMap((p) => pageNumbers[p.id] ?? [])),
    });
  }
  return labels;
}

/**
 * Whole-atlas index/overview front-matter page: each content page's footprint
 * (with its id + PDF page number), the route, and the stops drawn over a
 * small-scale basemap of the whole trip. `pageNumbers` maps page id → physical
 * PDF page so a reader can jump straight from the overview to a page.
 */
function OverviewPage({
  title,
  overview,
  panel,
  pageNumbers,
}: {
  title: string;
  overview: AtlasOverview;
  panel?: string;
  pageNumbers: Record<string, number>;
}) {
  const box = overviewBoxPoints();
  const routePts = overview.route ?? [];
  return (
    <Page
      size="LETTER"
      orientation="portrait"
      style={[styles.page, { padding: OVERVIEW_FURNITURE_PT.pagePadding }]}
    >
      <View style={styles.neatline}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.pageId}>OVERVIEW</Text>
        </View>
        <View
          style={[
            styles.mapPanel,
            {
              width: box.width + 2 * FURNITURE.panelBorder,
              height: box.height + 2 * FURNITURE.panelBorder,
            },
          ]}
        >
          {/* Same geometry as an atlas page: the overview panel is already
              cropped to the trip extent, so it fills the box exactly.
              `objectFit: "cover"` scaled it to the box's larger side and cropped
              the map away, which put the basemap out of register with the
              rectangles drawn over it. */}
          {panel ? (
            <Image src={panel} style={{ width: "100%", height: "100%" }} />
          ) : (
            <Text style={styles.panelNote}>Trip overview</Text>
          )}
          <OverlaySvg box={box}>
            {/* Route line (casing + ink) across the whole trip. */}
            {routePts.slice(1).map((p, i) => {
              const a = routePts[i]!;
              return (
                <Line key={`oc-${i}`} x1={a.x * box.width} y1={a.y * box.height} x2={p.x * box.width} y2={p.y * box.height} stroke={PARCHMENT} strokeOpacity={0.9} strokeWidth={6} />
              );
            })}
            {routePts.slice(1).map((p, i) => {
              const a = routePts[i]!;
              return (
                <Line key={`or-${i}`} x1={a.x * box.width} y1={a.y * box.height} x2={p.x * box.width} y2={p.y * box.height} stroke={INK} strokeWidth={2.5} />
              );
            })}
            {/* Page footprints. */}
            {overview.pages.map((r) => (
              <Rect
                key={`pr-${r.id}`}
                x={r.x * box.width}
                y={r.y * box.height}
                width={r.w * box.width}
                height={r.h * box.height}
                stroke={FOREST}
                strokeWidth={1.7}
                fill={FOREST}
                fillOpacity={0.06}
              />
            ))}
          </OverlaySvg>
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            {/* Stop markers: the locations' custom pins, in the HTML overlay layer. */}
            {(overview.stops ?? []).map((s, i) => (
              <LocationPin key={`os-${i}`} pin={s.pin} label={s.label} leftPct={s.x * 100} topPct={s.y * 100} size={22} />
            ))}
            {/* Page-number labels, positioned at each rectangle's centre (HTML layer for crisp text). */}
            {overviewPageLabels(overview.pages, pageNumbers).map((label) => (
              <View
                key={`pl-${label.id}`}
                style={{
                  position: "absolute",
                  left: `${label.x * 100}%`,
                  top: `${label.y * 100}%`,
                  marginLeft: -OVERVIEW_LABEL_WIDTH_PT / 2,
                  marginTop: -6,
                }}
              >
                <Text style={styles.overviewPageLabel}>{label.text}</Text>
              </View>
            ))}
          </View>
        </View>
        {/* Absorbs any slack between the furniture allowances above and what the
            furniture actually measures, keeping the map box constant. */}
        <View style={{ flexGrow: 1 }} />
        <View
          style={{
            height: OVERVIEW_FURNITURE_PT.captionRow,
            flexShrink: 0,
            justifyContent: "flex-end",
          }}
        >
          <Text style={[styles.small, { color: BARK }]}>
            {overview.pages.length} pages · numbers are PDF page numbers
          </Text>
        </View>
      </View>
    </Page>
  );
}

/** A location's table-of-contents entry: its L# id, name, and 1-based PDF page. */
interface TocEntry {
  id: string;
  name: string;
  page: number;
  /** Scale label, present when the page zooms away from the atlas scale. */
  scale?: string;
}

/**
 * Front-matter page listing the atlas's saved locations with the PDF page number
 * to flip to. Page numbers are physical (this TOC is page 1), so a reader can find
 * any location at a glance.
 */
/** "36.9°" for an azimuth, "5.00 km" / "850 m" for a distance. */
export function formatAzimuth(deg: number): string {
  return `${deg.toFixed(1)}°`;
}
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** The azimuth worksheet's instructions, in this project's own words. */
export const WORKSHEET_INSTRUCTIONS = [
  "For each leg, find both stops on their pages and join them with a straight line.",
  "Grid azimuth: with a protractor, measure the angle clockwise from grid north (along the vertical grid lines) to your line.",
  "Magnetic azimuth: take the G-M angle printed on the start's page. Subtract it if it is east; add it if it is west. That is the number to set on a compass.",
  "Distance: measure the line against the page's scale bar.",
  "Check your answers on the next page.",
] as const;

const worksheetStyles = StyleSheet.create({
  heading: { fontSize: 11, fontFamily: "Helvetica-Bold", color: FOREST, marginTop: 8, marginBottom: 6 },
  instruction: { fontSize: 8, color: INK, marginBottom: 2 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: BARK, paddingVertical: 6, alignItems: "flex-end" },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3, marginTop: 10 },
  leg: { width: 26, fontSize: 8, fontFamily: "Helvetica-Bold", color: FOREST },
  stops: { width: 150, fontSize: 8, color: INK },
  cell: { width: 82, fontSize: 8, color: INK },
  headCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: BARK },
  blank: { width: 70, borderBottomWidth: 0.5, borderBottomColor: INK, height: 10, marginRight: 12 },
});

/**
 * Stage 6B Level 4's azimuth worksheet and its answer key, appended after the map pages (opt-in).
 * One row per leg between consecutive stops; the worksheet leaves grid azimuth, magnetic azimuth
 * and distance blank, and the key, on its own page so it can be taken out, fills them in.
 */
function WorksheetPages({ title, legs, model }: { title: string; legs: WorksheetLeg[]; model?: string }) {
  const Header = ({ id }: { id: string }) => (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.pageId}>{id}</Text>
    </View>
  );
  // Plain words, not arrows: the standard-14 fonts print only WinAnsi, and "→" or "−" were
  // silently dropped from the page ("L1 Capitol  L2 Haymarket").
  const columns = ["Leg", "From, to", "Grid azimuth", "Magnetic azimuth", "Distance"];
  const HeadRow = () => (
    <View style={worksheetStyles.head} fixed>
      <Text style={[worksheetStyles.leg, worksheetStyles.headCell]}>{columns[0]}</Text>
      <Text style={[worksheetStyles.stops, worksheetStyles.headCell]}>{columns[1]}</Text>
      <Text style={[worksheetStyles.cell, worksheetStyles.headCell]}>{columns[2]}</Text>
      <Text style={[worksheetStyles.cell, worksheetStyles.headCell]}>{columns[3]}</Text>
      <Text style={[worksheetStyles.cell, worksheetStyles.headCell]}>{columns[4]}</Text>
    </View>
  );
  const stopsOf = (l: WorksheetLeg) => `${l.from} to ${l.to}`;
  return (
    <>
      <Page size="LETTER" orientation="portrait" style={[styles.page, { padding: 0.75 * PT }]}>
        <View style={[styles.neatline, { padding: 18 }]}>
          <Header id="WORKSHEET" />
          <Text style={worksheetStyles.heading}>Azimuth worksheet</Text>
          {WORKSHEET_INSTRUCTIONS.map((line, i) => (
            <Text key={i} style={worksheetStyles.instruction}>{`${i + 1}. ${line}`}</Text>
          ))}
          <HeadRow />
          {legs.map((l, i) => (
            <View key={i} style={worksheetStyles.row} wrap={false}>
              <Text style={worksheetStyles.leg}>{i + 1}</Text>
              <Text style={worksheetStyles.stops}>{stopsOf(l)}</Text>
              <View style={worksheetStyles.blank} />
              <View style={worksheetStyles.blank} />
              <View style={worksheetStyles.blank} />
            </View>
          ))}
        </View>
      </Page>
      <Page size="LETTER" orientation="portrait" style={[styles.page, { padding: 0.75 * PT }]}>
        <View style={[styles.neatline, { padding: 18 }]}>
          <Header id="ANSWER KEY" />
          <Text style={worksheetStyles.heading}>Azimuth worksheet: answers</Text>
          <HeadRow />
          {legs.map((l, i) => (
            <View key={i} style={worksheetStyles.row} wrap={false}>
              <Text style={worksheetStyles.leg}>{i + 1}</Text>
              <Text style={worksheetStyles.stops}>{stopsOf(l)}</Text>
              <Text style={worksheetStyles.cell}>{`${formatAzimuth(l.gridAzimuth)} (back ${formatAzimuth(l.backAzimuth)})`}</Text>
              <Text style={worksheetStyles.cell}>{l.magneticAzimuth === null ? "not available" : formatAzimuth(l.magneticAzimuth)}</Text>
              <Text style={worksheetStyles.cell}>{formatDistance(l.distanceMeters)}</Text>
            </View>
          ))}
          <View style={{ flexGrow: 1 }} />
          <Text style={[styles.small, { color: BARK }]}>
            {`Grid azimuths from grid north of each start's UTM zone; magnetic = grid - G-M${model ? ` (${model})` : ""}; distances on the ground. Answers to 0.1°: a protractor reading within a degree or two is good work.`}
          </Text>
        </View>
      </Page>
    </>
  );
}

function TableOfContents({ title, entries }: { title: string; entries: TocEntry[] }) {
  return (
    <Page
      size="LETTER"
      orientation="portrait"
      style={[styles.page, { padding: 0.75 * PT }]}
    >
      <View style={[styles.neatline, { padding: 18 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.pageId}>CONTENTS</Text>
        </View>
        <Text style={styles.tocHeading}>Locations</Text>
        <View>
          {entries.map((e) => (
            <View key={e.id} style={styles.tocRow} wrap={false}>
              <Text style={styles.tocLabel}>{e.id}</Text>
              <Text style={styles.tocName}>{e.name}</Text>
              {e.scale ? <Text style={styles.tocScale}>{e.scale}</Text> : null}
              <Text style={styles.tocPage}>{e.page}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexGrow: 1 }} />
        <Text style={[styles.small, { color: BARK }]}>
          {entries.length} location{entries.length === 1 ? "" : "s"} · page numbers refer to this PDF
        </Text>
      </View>
    </Page>
  );
}

export function AtlasDocument({
  contract,
  title,
  panels,
  grids,
  routes,
  landmarks,
  toc = true,
  overview,
  overviewPanel,
  referenceGrid = true,
  notes = true,
  attribution,
  printDpi,
  explorerName,
  atlasDate,
  cropMarks = false,
  locatorInset = false,
  norths,
  worksheet,
}: {
  contract: AtlasContract;
  title: string;
  /** map pageId -> map-panel image data URI (e.g. "data:image/png;base64,…") */
  panels?: Record<string, string>;
  /** map pageId -> USNG grid overlay (tier >= 3 only) */
  grids?: Record<string, UsngGridOverlay>;
  /** map pageId -> route overlay (corridor R# pages only); additive, mirrors panels/grids */
  routes?: Record<string, RouteOverlay>;
  /** map pageId -> selected landmarks; additive furniture, mirrors panels/grids/routes */
  landmarks?: Record<string, PlacedLandmark[]>;
  /** Prepend a locations table-of-contents page when titled location pages exist. Default true. */
  toc?: boolean;
  /** Whole-atlas index/overview, prepended as front matter when present. */
  overview?: AtlasOverview;
  /** Basemap panel (data URI) for the overview, drawn under the page rectangles. */
  overviewPanel?: string;
  /** Draw the alphanumeric reference-grid border on each map page. Default true. */
  referenceGrid?: boolean;
  /** Show the foot-of-page notes area on each map page. Default true. */
  notes?: boolean;
  /**
   * Credit line for the basemap tiles the panels were built from, as reported by
   * `map-sources`. Omitted when no basemap was rendered — there is then no map
   * data to credit.
   */
  attribution?: string;
  /**
   * map pageId -> the print resolution (DPI) that page's panel was actually
   * delivered at, as measured by `render-cli` against the page's map box.
   *
   * Keyed per page, and additive like `panels`/`grids`, because an atlas can mix
   * scales: a zoom ladder puts 1:100,000 and 1:24,000 in one book and they print
   * up to a whole zoom level — 2x — apart. A page with a panel but no entry here
   * says so rather than printing a number; see {@link printResolutionCaption}.
   */
  printDpi?: Record<string, number>;
  /** With `atlasDate`, prints a title page ahead of everything else when either is set. */
  explorerName?: string;
  atlasDate?: string;
  /** Crop marks at each map page's map-box corners. Default false. */
  cropMarks?: boolean;
  /** Grid-locator inset on each map page (multi-page atlases). Default false. */
  locatorInset?: boolean;
  /** map pageId -> three norths for tier-4 pages (the declination diagram). */
  norths?: Record<string, PageNorths>;
  /** Azimuth worksheet and answer key appended after the map pages, when there are legs. */
  worksheet?: { legs: WorksheetLeg[]; model?: string };
}) {
  // Front matter (title page, overview, then TOC) precedes the content pages and shifts their
  // physical page numbers. Both are computed from the same offset so the TOC, the
  // per-page footer numbers, and the overview's page labels all agree.
  const hasTitledPages = contract.pages.some((p) => typeof p.title === "string" && p.title.length > 0);
  const showToc = toc && hasTitledPages;
  const showOverview = !!overview && overview.pages.length > 0;
  const showTitlePage = !!explorerName?.trim() || !!atlasDate?.trim();
  const frontMatter = (showTitlePage ? 1 : 0) + (showOverview ? 1 : 0) + (showToc ? 1 : 0);
  // Physical PDF page number for the content page at contract index i.
  const physicalPage = (i: number) => frontMatter + i + 1;

  // Locations TOC: every titled (location) page, with its physical PDF page number.
  const tocEntries: TocEntry[] = contract.pages
    .map((page, i) => ({ page, i }))
    .filter(({ page }) => typeof page.title === "string" && page.title.length > 0)
    .map(({ page, i }) => ({
      id: page.id,
      name: page.title!,
      page: physicalPage(i),
      // Show the level's scale when the page zooms away from the atlas scale, so a
      // zoom ladder (L1a/L1b/L1c) reads as regional → local → detail in the contents.
      ...(page.scale && page.scale.id !== contract.scale.id ? { scale: page.scale.label } : {}),
    }));

  // page id -> physical page number, for the overview's rectangle labels.
  const pageNumbers: Record<string, number> = {};
  contract.pages.forEach((page, i) => { pageNumbers[page.id] = physicalPage(i); });

  return (
    <Document title={title}>
      {showTitlePage && (
        <TitlePage title={title} explorerName={explorerName?.trim()} atlasDate={atlasDate?.trim()} />
      )}
      {showOverview && <OverviewPage title={title} overview={overview!} panel={overviewPanel} pageNumbers={pageNumbers} />}
      {showToc && <TableOfContents title={title} entries={tocEntries} />}
      {contract.pages.map((page, i) => (
        <AtlasPageView
          key={page.id}
          page={page}
          contract={contract}
          title={title}
          panel={panels?.[page.id]}
          grid={grids?.[page.id]}
          route={routes?.[page.id]}
          landmarks={landmarks?.[page.id]}
          pageNumber={physicalPage(i)}
          referenceGrid={referenceGrid}
          notes={notes}
          attribution={attribution}
          printDpi={printDpi?.[page.id]}
          cropMarks={cropMarks}
          locatorInset={locatorInset}
          norths={norths?.[page.id]}
        />
      ))}
      {worksheet && worksheet.legs.length > 0 ? (
        <WorksheetPages title={title} legs={worksheet.legs} {...(worksheet.model ? { model: worksheet.model } : {})} />
      ) : null}
    </Document>
  );
}

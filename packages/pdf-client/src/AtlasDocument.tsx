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
  type UsngGridOverlay,
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
  overviewPageLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK, textAlign: "center", width: 24 },
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
    </OverlaySvg>
  );
}

/** USNG collar badge shown in the tier-3 footer. */
function UsngCollar({ collar }: { collar: UsngGridOverlay["collar"] }) {
  if (!collar.zoneDesignator && !collar.hundredKmSquare) return null;
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={[styles.small, { fontFamily: "Helvetica-Bold" }]}>
        {collar.zoneDesignator} {collar.hundredKmSquare} · USNG
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
}) {
  const showTier2 = page.tier >= 2;
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
            {/* Route furniture is additive and only present for corridor (R#) pages. */}
            {route && page.id.startsWith("R") ? <RouteLayer overlay={route} box={box} /> : null}
            {/* Landmark furniture is additive, keyed by page.id like routes/grids. */}
            {landmarks && landmarks.length > 0 ? <LandmarkLayer landmarks={landmarks} box={box} /> : null}
            {landmarks && landmarks.length > 0 ? <LandmarkLegend landmarks={landmarks} /> : null}
            {/* Alphanumeric reference grid for writing cell coordinates. */}
            {referenceGrid ? <ReferenceGrid box={box} /> : null}
            {/* A location (L#) page is centred on its location → mark it with the pin. */}
            {page.id.startsWith("L") ? (
              <LocationPin pin={page.pin} label={page.id} leftPct={50} topPct={50} size={34} />
            ) : null}
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
            <Text style={styles.attribution}>
              {"© OpenStreetMap contributors · USGS — Journey Book"}
            </Text>
          </View>
          <CalibrationTick />
          {showTier2 ? <CompassRose /> : null}
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
  const SIZE = 1000;
  const routePts = overview.route ?? [];
  return (
    <Page size="LETTER" orientation="portrait" style={[styles.page, { padding: 0.75 * PT }]}>
      <View style={styles.neatline}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.pageId}>OVERVIEW</Text>
        </View>
        <View style={[styles.panel, { position: "relative" }]}>
          {panel ? (
            <Image src={panel} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Text style={styles.panelNote}>Trip overview</Text>
          )}
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            <Svg width="100%" height="100%" viewBox={`0 0 ${SIZE} ${SIZE}`}>
              {/* Route line (casing + ink) across the whole trip. */}
              {routePts.slice(1).map((p, i) => {
                const a = routePts[i]!;
                return (
                  <Line key={`oc-${i}`} x1={a.x * SIZE} y1={a.y * SIZE} x2={p.x * SIZE} y2={p.y * SIZE} stroke={PARCHMENT} strokeOpacity={0.9} strokeWidth={6} />
                );
              })}
              {routePts.slice(1).map((p, i) => {
                const a = routePts[i]!;
                return (
                  <Line key={`or-${i}`} x1={a.x * SIZE} y1={a.y * SIZE} x2={p.x * SIZE} y2={p.y * SIZE} stroke={INK} strokeWidth={2.5} />
                );
              })}
              {/* Page footprints. */}
              {overview.pages.map((r) => (
                <Rect
                  key={`pr-${r.id}`}
                  x={r.x * SIZE}
                  y={r.y * SIZE}
                  width={r.w * SIZE}
                  height={r.h * SIZE}
                  stroke={FOREST}
                  strokeWidth={1.7}
                  fill={FOREST}
                  fillOpacity={0.06}
                />
              ))}
            </Svg>
            {/* Stop markers: the locations' custom pins, in the HTML overlay layer. */}
            {(overview.stops ?? []).map((s, i) => (
              <LocationPin key={`os-${i}`} pin={s.pin} label={s.label} leftPct={s.x * 100} topPct={s.y * 100} size={22} />
            ))}
            {/* Page-number labels, positioned at each rectangle's centre (HTML layer for crisp text). */}
            {overview.pages.map((r) => (
              <View
                key={`pl-${r.id}`}
                style={{
                  position: "absolute",
                  left: `${(r.x + r.w / 2) * 100}%`,
                  top: `${(r.y + r.h / 2) * 100}%`,
                  marginLeft: -12,
                  marginTop: -6,
                }}
              >
                <Text style={styles.overviewPageLabel}>{pageNumbers[r.id] ?? ""}</Text>
              </View>
            ))}
          </View>
        </View>
        <Text style={[styles.small, { color: BARK, marginTop: 4 }]}>
          {overview.pages.length} pages · numbers are PDF page numbers
        </Text>
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
}) {
  // Front matter (overview, then TOC) precedes the content pages and shifts their
  // physical page numbers. Both are computed from the same offset so the TOC, the
  // per-page footer numbers, and the overview's page labels all agree.
  const hasTitledPages = contract.pages.some((p) => typeof p.title === "string" && p.title.length > 0);
  const showToc = toc && hasTitledPages;
  const showOverview = !!overview && overview.pages.length > 0;
  const frontMatter = (showOverview ? 1 : 0) + (showToc ? 1 : 0);
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
        />
      ))}
    </Document>
  );
}

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
  StyleSheet,
} from "@react-pdf/renderer";
import {
  niceScaleBar,
  POINTS_PER_INCH as PT,
  type AtlasContract,
  type AtlasOverview,
  type AtlasPage,
  type PageMargins,
  type PlacedLandmark,
  type ScalePreset,
  type UsngGridOverlay,
} from "@journeybook/atlas-core";
import { brand } from "@journeybook/ui";

// Brand token aliases for furniture styling — values come from @journeybook/ui/tokens.
const INK = brand.ink;
const FOREST = brand.forest;
const BARK = brand.bark;
const PARCHMENT = brand.parchment;

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: INK },
  neatline: { flexGrow: 1, borderWidth: 1.5, borderColor: BARK, padding: 6 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", color: FOREST },
  pageId: { fontSize: 16, fontFamily: "Helvetica-Bold", color: FOREST },
  edgeLabel: { fontSize: 7, color: BARK, textAlign: "center" },
  panelRow: { flexDirection: "row", flexGrow: 1, alignItems: "stretch" },
  panel: {
    flexGrow: 1,
    backgroundColor: PARCHMENT,
    borderWidth: 1,
    borderColor: BARK,
    alignItems: "center",
    justifyContent: "center",
  },
  panelNote: { fontSize: 8, color: BARK },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 4,
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
  tocLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: FOREST, width: 30 },
  tocName: { fontSize: 10, color: INK, flexGrow: 1, flexShrink: 1 },
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

function sheetWidthInches(orientation: AtlasPage["orientation"]): number {
  return orientation === "landscape" ? 11 : 8.5;
}

function printableWidthInches(margins: PageMargins, orientation: AtlasPage["orientation"]): number {
  return sheetWidthInches(orientation) - margins.left - margins.right - (margins.gutter ?? 0);
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
function RouteLayer({ overlay }: { overlay: RouteOverlay }) {
  const SIZE = 1000;
  const segments = overlay.points.reduce<{ a: { x: number; y: number }; b: { x: number; y: number } }[]>(
    (acc, b, i) => {
      const a = overlay.points[i - 1];
      if (i > 0 && a) acc.push({ a, b });
      return acc;
    },
    [],
  );
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Light casing drawn under the dark stroke so the route reads over any basemap. */}
        {segments.map((s, i) => (
          <Line
            key={`casing-${i}`}
            x1={s.a.x * SIZE}
            y1={s.a.y * SIZE}
            x2={s.b.x * SIZE}
            y2={s.b.y * SIZE}
            stroke={PARCHMENT}
            strokeOpacity={0.95}
            strokeWidth={10}
          />
        ))}
        {/* Dark route stroke on top. */}
        {segments.map((s, i) => (
          <Line
            key={`route-${i}`}
            x1={s.a.x * SIZE}
            y1={s.a.y * SIZE}
            x2={s.b.x * SIZE}
            y2={s.b.y * SIZE}
            stroke={INK}
            strokeWidth={4}
          />
        ))}
        {/* Stop markers where a stop lands on/near this page. */}
        {(overlay.stops ?? []).map((stop, i) => (
          <Circle
            key={`stop-${i}`}
            cx={stop.x * SIZE}
            cy={stop.y * SIZE}
            r={11}
            fill={FOREST}
            stroke={PARCHMENT}
            strokeWidth={3}
          />
        ))}
      </Svg>
    </View>
  );
}

/** SVG grid overlay for a USNG/tier-3 page, drawn over the map panel. */
function UsngGridLayer({ overlay }: { overlay: UsngGridOverlay }) {
  const SIZE = 1000;
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {overlay.lines.map((line, i) => (
          <Line
            key={i}
            x1={line.x1 * SIZE}
            y1={line.y1 * SIZE}
            x2={line.x2 * SIZE}
            y2={line.y2 * SIZE}
            stroke={FOREST}
            strokeOpacity={0.45}
            strokeWidth={2}
          />
        ))}
      </Svg>
    </View>
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
 * (`labelPlaced`). Coordinates are normalized (0..1) over the same 1000×1000
 * viewBox as RouteLayer/UsngGridLayer. Additive furniture keyed by `page.id`,
 * so the core AtlasContract/AtlasPage types stay untouched.
 */
function LandmarkLayer({ landmarks }: { landmarks: PlacedLandmark[] }) {
  const SIZE = 1000;
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {landmarks.map((lm, i) => (
          <Polygon
            key={`landmark-${i}`}
            points={landmarkDiamond(lm.x * SIZE, lm.y * SIZE, 13)}
            fill={BARK}
            stroke={PARCHMENT}
            strokeWidth={3}
          />
        ))}
        {landmarks.map((lm, i) =>
          lm.labelPlaced ? (
            <Text
              key={`landmark-label-${i}`}
              x={lm.x * SIZE + 17}
              y={lm.y * SIZE + 5}
              style={{ fontSize: 22, fill: INK }}
            >
              {lm.name}
            </Text>
          ) : null,
        )}
      </Svg>
    </View>
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
}) {
  const showTier2 = page.tier >= 2;
  const showTier3 = page.tier >= 3;
  const maxBarInches = printableWidthInches(contract.margins, page.orientation) * 0.45;
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
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.pageId}>{page.id}</Text>
        </View>

        <Text style={styles.edgeLabel}>{continuation("NORTH", page.neighbors.north)}</Text>

        <View style={styles.panelRow}>
          <Text style={[styles.edgeLabel, { width: 54, alignSelf: "center" }]}>
            {continuation("WEST", page.neighbors.west)}
          </Text>
          <View style={[styles.panel, { position: "relative" }]}>
            {panel ? (
              showTier3 ? (
                <Image src={panel} style={{ width: "100%", height: "100%" }} />
              ) : (
                <Image src={panel} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )
            ) : (
              <Text style={styles.panelNote}>map panel — pass --basemap to render</Text>
            )}
            {showTier3 && grid ? <UsngGridLayer overlay={grid} /> : null}
            {/* Route furniture is additive and only present for corridor (R#) pages. */}
            {route && page.id.startsWith("R") ? <RouteLayer overlay={route} /> : null}
            {/* Landmark furniture is additive, keyed by page.id like routes/grids. */}
            {landmarks && landmarks.length > 0 ? <LandmarkLayer landmarks={landmarks} /> : null}
            {landmarks && landmarks.length > 0 ? <LandmarkLegend landmarks={landmarks} /> : null}
          </View>
          <Text style={[styles.edgeLabel, { width: 54, alignSelf: "center" }]}>
            {continuation("EAST", page.neighbors.east)}
          </Text>
        </View>

        <Text style={styles.edgeLabel}>{continuation("SOUTH", page.neighbors.south)}</Text>

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
                  strokeWidth={1.5}
                  fill={FOREST}
                  fillOpacity={0.06}
                />
              ))}
              {/* Stop markers. */}
              {(overview.stops ?? []).map((s, i) => (
                <Circle key={`os-${i}`} cx={s.x * SIZE} cy={s.y * SIZE} r={7} fill={FOREST} stroke={PARCHMENT} strokeWidth={2} />
              ))}
            </Svg>
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
    .map(({ page, i }) => ({ id: page.id, name: page.title!, page: physicalPage(i) }));

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
        />
      ))}
    </Document>
  );
}

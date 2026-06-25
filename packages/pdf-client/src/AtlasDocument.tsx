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
  type AtlasPage,
  type PageMargins,
  type ScalePreset,
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

function AtlasPageView({
  page,
  contract,
  title,
  panel,
}: {
  page: AtlasPage;
  contract: AtlasContract;
  title: string;
  panel?: string;
}) {
  const showTier2 = page.tier >= 2;
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
          <View style={styles.panel}>
            {panel ? (
              <Image src={panel} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Text style={styles.panelNote}>map panel — pass --basemap to render</Text>
            )}
          </View>
          <Text style={[styles.edgeLabel, { width: 54, alignSelf: "center" }]}>
            {continuation("EAST", page.neighbors.east)}
          </Text>
        </View>

        <Text style={styles.edgeLabel}>{continuation("SOUTH", page.neighbors.south)}</Text>

        <View style={styles.footer}>
          <View>
            {showTier2 ? <ScaleBar scale={contract.scale} maxInches={maxBarInches} /> : null}
            <Text style={styles.attribution}>
              {"© OpenStreetMap contributors · USGS — Journey Book"}
            </Text>
          </View>
          <CalibrationTick />
          {showTier2 ? <CompassRose /> : null}
        </View>
      </View>
    </Page>
  );
}

export function AtlasDocument({
  contract,
  title,
  panels,
}: {
  contract: AtlasContract;
  title: string;
  /** map pageId -> map-panel image data URI (e.g. "data:image/png;base64,…") */
  panels?: Record<string, string>;
}) {
  return (
    <Document title={title}>
      {contract.pages.map((page) => (
        <AtlasPageView
          key={page.id}
          page={page}
          contract={contract}
          title={title}
          panel={panels?.[page.id]}
        />
      ))}
    </Document>
  );
}

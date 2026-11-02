import { Document, Line, Page, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { brand } from "@journeybook/ui";

/**
 * The one-page physical calibration target: rulers of known length to check with a
 * real ruler, on both axes because a printer can scale them differently.
 *
 * Every map page carries a 1-inch tick, which shows that a sheet was scaled. This page
 * measures by how much, before an atlas is printed, and needs no project or tiles.
 */

const INK = brand.ink;

const PT_PER_INCH = 72;
const PT_PER_CM = 72 / 2.54;
const PAGE = { width: 612, height: 792 };

/** Ruler lengths and positions, in points. Exported so the test can state what it measures. */
export const CALIBRATION_RULERS = {
  inches: { x: 54, y: 214, inches: 6 },
  centimetres: { x: 54, y: 294, cm: 15 },
  vertical: { x: 540, y: 144, inches: 8 },
  square: { x: 54, y: 374, side: 2 * PT_PER_INCH },
} as const;

const TICK = { major: 14, minor: 7 };

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: INK },
  title: { position: "absolute", left: 54, top: 54, fontSize: 18, fontFamily: "Helvetica-Bold" },
  step: { position: "absolute", left: 54, width: 440, fontSize: 10 },
  caption: { position: "absolute", fontSize: 9 },
  tickLabel: { position: "absolute", fontSize: 8, width: 20, textAlign: "center" },
});

function Caption({ left, top, children }: { left: number; top: number; children: string }) {
  return <Text style={[styles.caption, { left, top }]}>{children}</Text>;
}

/** Tick positions along a ruler, from 0 to `length` in steps of `step`. */
function positions(length: number, step: number): number[] {
  return Array.from({ length: Math.round(length / step) + 1 }, (_, i) => i * step);
}

function CalibrationPage() {
  const { inches, centimetres, vertical, square } = CALIBRATION_RULERS;
  const inchLength = inches.inches * PT_PER_INCH;
  const cmLength = centimetres.cm * PT_PER_CM;
  const verticalLength = vertical.inches * PT_PER_INCH;

  return (
    <Page size="LETTER" orientation="portrait" style={styles.page}>
      <Text style={styles.title}>Journey Book print check</Text>
      <Text style={[styles.step, { top: 84 }]}>
        1. Print this page at 100% (&quot;Actual size&quot;), not &quot;Fit to page&quot;.
      </Text>
      <Text style={[styles.step, { top: 100 }]}>
        2. Hold a real ruler against each scale below, including the tall one on the right.
      </Text>
      <Text style={[styles.step, { top: 116 }]}>
        3. If they match, your printer is true to scale and your atlas scale bars can be trusted.
      </Text>

      <Svg width={PAGE.width} height={PAGE.height} style={{ position: "absolute", left: 0, top: 0 }}>
        <Line x1={inches.x} y1={inches.y} x2={inches.x + inchLength} y2={inches.y} stroke={INK} strokeWidth={0.75} />
        {positions(inchLength, PT_PER_INCH / 4).map((at, i) => (
          <Line
            key={`in-${i}`}
            x1={inches.x + at}
            y1={inches.y}
            x2={inches.x + at}
            y2={inches.y - (i % 4 === 0 ? TICK.major : TICK.minor)}
            stroke={INK}
            strokeWidth={0.5}
          />
        ))}

        <Line x1={centimetres.x} y1={centimetres.y} x2={centimetres.x + cmLength} y2={centimetres.y} stroke={INK} strokeWidth={0.75} />
        {positions(cmLength, PT_PER_CM / 2).map((at, i) => (
          <Line
            key={`cm-${i}`}
            x1={centimetres.x + at}
            y1={centimetres.y}
            x2={centimetres.x + at}
            y2={centimetres.y - (i % 2 === 0 ? TICK.major : TICK.minor)}
            stroke={INK}
            strokeWidth={0.5}
          />
        ))}

        <Line x1={vertical.x} y1={vertical.y} x2={vertical.x} y2={vertical.y + verticalLength} stroke={INK} strokeWidth={0.75} />
        {positions(verticalLength, PT_PER_INCH / 4).map((at, i) => (
          <Line
            key={`v-${i}`}
            x1={vertical.x}
            y1={vertical.y + at}
            x2={vertical.x + (i % 4 === 0 ? TICK.major : TICK.minor)}
            y2={vertical.y + at}
            stroke={INK}
            strokeWidth={0.5}
          />
        ))}

        <Rect x={square.x} y={square.y} width={square.side} height={square.side} stroke={INK} strokeWidth={0.75} fill="none" />
      </Svg>

      <Caption left={inches.x} top={inches.y + 6}>{`${inches.inches} inches`}</Caption>
      {positions(inchLength, PT_PER_INCH).map((at, i) => (
        <Text key={`inl-${i}`} style={[styles.tickLabel, { left: inches.x + at - 10, top: inches.y - 26 }]}>
          {String(i)}
        </Text>
      ))}

      <Caption left={centimetres.x} top={centimetres.y + 6}>{`${centimetres.cm} centimetres`}</Caption>
      {positions(cmLength, PT_PER_CM).map((at, i) => (
        <Text key={`cml-${i}`} style={[styles.tickLabel, { left: centimetres.x + at - 10, top: centimetres.y - 26 }]}>
          {String(i)}
        </Text>
      ))}

      <Caption left={vertical.x - 60} top={vertical.y - 14}>{`${vertical.inches} inches, top to bottom`}</Caption>
      <Caption left={square.x} top={square.y + square.side + 6}>
        A 2-inch square. If its sides differ, the printer scaled the page unevenly.
      </Caption>

      <View style={{ position: "absolute", left: 54, bottom: 54, width: 440 }}>
        <Text style={{ fontSize: 9 }}>
          If a scale prints short or long, turn off any scaling in the print dialog and try again.
          A page that prints scaled makes every distance measured on the atlas wrong by the same amount.
        </Text>
      </View>
    </Page>
  );
}

export function CalibrationDocument() {
  return (
    <Document title="Journey Book print check">
      <CalibrationPage />
    </Document>
  );
}

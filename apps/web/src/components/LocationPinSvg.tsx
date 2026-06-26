import { PIN_SHAPES, resolvePinShape, resolvePinColor } from "@journeybook/ui";

interface PinProps {
  shape?: string | null;
  color?: string | null;
  label?: string;
  size?: number;
}

/** Inline React SVG of a location pin (shared shape set) — used in the editor + list. */
export function LocationPinSvg({ shape, color, label, size = 28 }: PinProps) {
  const def = PIN_SHAPES[resolvePinShape(shape)];
  const fill = resolvePinColor(color);
  const [lx, ly] = def.labelAt;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <path d={def.path} fill={fill} stroke="#ede4cf" strokeWidth={1} />
      {label ? (
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight="bold" fill="#ffffff">
          {label}
        </text>
      ) : null}
    </svg>
  );
}

/** SVG markup string for a MapLibre marker element. Anchor matches the shape's tip. */
export function pinSvgString(shape: string | null | undefined, color: string | null | undefined, label: string, size = 30): string {
  const def = PIN_SHAPES[resolvePinShape(shape)];
  const fill = resolvePinColor(color);
  const [lx, ly] = def.labelAt;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))">` +
    `<path d="${def.path}" fill="${fill}" stroke="#ede4cf" stroke-width="1"/>` +
    `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" font-size="8" font-weight="bold" fill="#fff">${label}</text>` +
    `</svg>`
  );
}

/** MapLibre marker anchor for a shape: bottom-tip shapes hang from the point. */
export function pinAnchor(shape: string | null | undefined): "bottom" | "center" {
  return PIN_SHAPES[resolvePinShape(shape)].anchor[1] >= 18 ? "bottom" : "center";
}

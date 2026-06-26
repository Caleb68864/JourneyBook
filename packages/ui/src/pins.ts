/**
 * Location pin shapes, shared by the web map (MapLibre markers) and the PDF
 * renderer (@react-pdf SVG) so a location's pin looks identical in both. Each
 * shape is an SVG path in a 24×24 viewBox with an `anchor` (the point that sits
 * on the map coordinate) and `labelAt` (where the L# number is centered).
 */

export type PinShape = "shield" | "teardrop" | "circle" | "diamond" | "star" | "flag";

export interface PinShapeDef {
  id: PinShape;
  label: string;
  /** SVG path `d` in a 24×24 viewBox. */
  path: string;
  /** Point (viewBox units) placed on the map coordinate. */
  anchor: [number, number];
  /** Center point (viewBox units) for the L# number label. */
  labelAt: [number, number];
}

export const PIN_SHAPES: Record<PinShape, PinShapeDef> = {
  shield: {
    id: "shield",
    label: "Shield",
    path: "M12 2 L20 5 L20 10 C20 16 12 22 12 22 C12 22 4 16 4 10 L4 5 Z",
    anchor: [12, 22],
    labelAt: [12, 10],
  },
  teardrop: {
    id: "teardrop",
    label: "Teardrop",
    path: "M12 2 C8.1 2 5 5.1 5 9 C5 14.25 12 22 12 22 C12 22 19 14.25 19 9 C19 5.1 15.9 2 12 2 Z",
    anchor: [12, 22],
    labelAt: [12, 9],
  },
  circle: {
    id: "circle",
    label: "Circle",
    path: "M3 12 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z",
    anchor: [12, 12],
    labelAt: [12, 12],
  },
  diamond: {
    id: "diamond",
    label: "Diamond",
    path: "M12 2 L22 12 L12 22 L2 12 Z",
    anchor: [12, 12],
    labelAt: [12, 12],
  },
  star: {
    id: "star",
    label: "Star",
    path: "M12 2 L14.7 9 L22 9.3 L16.2 13.9 L18.2 21 L12 16.8 L5.8 21 L7.8 13.9 L2 9.3 L9.3 9 Z",
    anchor: [12, 12],
    labelAt: [12, 12.5],
  },
  flag: {
    id: "flag",
    label: "Flag",
    path: "M5 2 L7 2 L7 22 L5 22 Z M7 3 L19 6 L7 10 Z",
    anchor: [6, 22],
    labelAt: [13, 6.5],
  },
};

export const PIN_SHAPE_LIST: PinShapeDef[] = Object.values(PIN_SHAPES);

/** Curated swatches for the pin color picker (the editor also allows a free hex). */
export const PIN_COLORS: { name: string; hex: string }[] = [
  { name: "Forest", hex: "#1f3d2b" },
  { name: "Campfire", hex: "#c25e1d" },
  { name: "Moss", hex: "#5b7553" },
  { name: "Bark", hex: "#6b4f36" },
  { name: "Sky", hex: "#2b6d9f" },
  { name: "Berry", hex: "#9f2b4f" },
  { name: "Gold", hex: "#e6b422" },
  { name: "Charcoal", hex: "#2a2a28" },
];

export const DEFAULT_PIN_SHAPE: PinShape = "shield";
export const DEFAULT_PIN_COLOR = "#1f3d2b";

/** Normalize a possibly-missing shape id to a known shape. */
export function resolvePinShape(shape: string | null | undefined): PinShape {
  return shape && shape in PIN_SHAPES ? (shape as PinShape) : DEFAULT_PIN_SHAPE;
}

/** Normalize a possibly-missing color to a hex string. */
export function resolvePinColor(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_PIN_COLOR;
}

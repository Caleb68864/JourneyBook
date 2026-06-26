/**
 * @journeybook/ui
 *
 * Shared UI/theme components and design tokens.
 */

export const UI_VERSION = "0.1.0";

export { palette, fonts, brand } from "./tokens.js";
export type { Palette, Fonts, Brand } from "./tokens.js";

export {
  PIN_SHAPES,
  PIN_SHAPE_LIST,
  PIN_COLORS,
  DEFAULT_PIN_SHAPE,
  DEFAULT_PIN_COLOR,
  resolvePinShape,
  resolvePinColor,
} from "./pins.js";
export type { PinShape, PinShapeDef } from "./pins.js";

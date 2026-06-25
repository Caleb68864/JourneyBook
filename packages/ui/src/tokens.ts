/**
 * Canonical JourneyBook brand tokens.
 * These values mirror the @theme block in apps/web/src/index.css.
 * Import from this module for non-Tailwind consumers (pdf-client, tests).
 */

export const palette = {
  forest: {
    900: "#16291d",
    800: "#1b3324",
    700: "#1f3d2b",
    600: "#285238",
    500: "#356b49",
  },
  moss: {
    600: "#5b7553",
    500: "#6f8b66",
    300: "#a9bda0",
  },
  bark: {
    700: "#4a361f",
    600: "#6b4f36",
    400: "#9c7c5a",
  },
  parchment: {
    300: "#e4d8bd",
    200: "#ede4cf",
  },
  cream: {
    100: "#f7f2e7",
    50: "#fbf8f0",
  },
  campfire: {
    600: "#c25e1d",
    500: "#d9742b",
  },
  trail: {
    500: "#e6b422",
  },
  charcoal: {
    900: "#23211c",
    700: "#3a362d",
  },
} as const;

export const fonts = {
  display: '"Saira Stencil One", "Impact", system-ui, sans-serif',
  sans: '"Source Sans 3", ui-sans-serif, system-ui, sans-serif',
  mono: '"Spline Sans Mono", ui-monospace, "SFMono-Regular", monospace',
} as const;

/** Convenience aliases for furniture elements used in pdf-client. */
export const brand = {
  ink: palette.charcoal[900],
  forest: palette.forest[700],
  bark: palette.bark[600],
  parchment: palette.parchment[200],
} as const;

export type Palette = typeof palette;
export type Fonts = typeof fonts;
export type Brand = typeof brand;

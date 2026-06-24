import type { ScalePreset } from "./model.js";

/** Exact SI definition of one inch, in meters. */
export const METERS_PER_INCH = 0.0254;

/**
 * Ground metres represented by one inch on the page at a given map scale.
 * At 1:R, one page inch is R inches on the ground = R * 0.0254 metres.
 */
export function metersPerInch(scale: ScalePreset): number {
  return scale.ratio * METERS_PER_INCH;
}

/** Ground metres represented by a scale bar of the given length in inches. */
export function scaleBarGroundMeters(scale: ScalePreset, inches: number): number {
  return inches * metersPerInch(scale);
}

export interface ScaleBar {
  /** round ground distance the bar represents, in metres */
  groundMeters: number;
  /** printed length of the bar, in inches */
  inches: number;
  /** human label, e.g. "1 km" or "500 m" */
  label: string;
}

const NICE_STEPS = [1, 2, 5];

/**
 * Choose the largest "nice" round ground distance (1/2/5 × 10ⁿ metres) whose
 * bar fits within <paramref name="maxInches"/> at the given scale, with its
 * true printed length and a human label.
 */
export function niceScaleBar(scale: ScalePreset, maxInches: number): ScaleBar {
  const maxMeters = maxInches * metersPerInch(scale);

  let groundMeters = NICE_STEPS[0]!;
  for (let pow = 0; pow <= 8; pow++) {
    for (const step of NICE_STEPS) {
      const value = step * 10 ** pow;
      if (value <= maxMeters) groundMeters = value;
    }
  }

  const label =
    groundMeters >= 1000 ? `${groundMeters / 1000} km` : `${groundMeters} m`;

  return { groundMeters, inches: groundMeters / metersPerInch(scale), label };
}

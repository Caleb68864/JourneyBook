/**
 * @journeybook/atlas-core
 *
 * Shared, renderer-agnostic atlas domain logic: Letter page geometry, standard
 * scale presets, per-page local projection, page-grid splitting, and the
 * page-furniture JSON contract that every renderer (headless React-PDF, browser
 * preview, optional QuestPDF, future Android) consumes.
 *
 * Barrel only — definitions live in the leaf modules below.
 */

export * from "./model.js";
export * from "./scale.js";
export * from "./page.js";
export * from "./projection.js";
export * from "./grid.js";
export * from "./validation.js";

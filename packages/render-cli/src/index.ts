/**
 * @journeybook/render-cli
 *
 * Programmatic entry points for the headless render pipeline. The executable
 * lives in cli.ts. Stage 0 skeleton: wiring only; the render/validate commands
 * are implemented across Stages 1C–1E.
 */

export { runCli } from "./cli.js";
export {
  renderAtlas,
  assembleContract,
  RenderCancelledError,
  NON_WIRE_INPUT_FIELDS,
  type RenderAtlasInput,
  type RenderAtlasResult,
  type DeliveredDpi,
  type RenderLocation,
  type RenderProgress,
  type AssembledAtlas,
} from "./render.js";
export { loadLocationsFile, parseLocationsCsv, parseLocationsJson } from "./locations.js";
export {
  tileBaseUrlError,
  parseTileBaseUrlAllowlist,
  type TileBaseUrlPolicy,
} from "./tile-url.js";
export const RENDER_CLI_VERSION = "0.0.0";

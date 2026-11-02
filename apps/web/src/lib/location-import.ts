/**
 * The location panel's import file: CSV, or the JSON the CLI's `--locations` also
 * takes — an array of locations, or a project backup (`{ project, locations }`).
 *
 * JSON becomes CSV here rather than gaining a second server path, so a backup gets
 * the one importer's guarantees: every row and every scale validated by
 * `LocationService.ImportAsync`, all-or-nothing, in one request. Field aliases follow
 * `normalizeLocationEntry` in `packages/render-cli/src/locations.ts`; `render-cli`
 * cannot be imported here because it is the Node side of the render path.
 */

const CSV_HEADER = "name,lng,lat,notes,scale,pin,color,zoom";

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | undefined {
  return typeof value === "object" && value !== null ? (value as Loose) : undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstText(...values: unknown[]): string {
  return values.map(asText).find((v) => v.trim() !== "") ?? "";
}

/** RFC 4180 quoting, which both CSV parsers read back. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function entryToCsvRow(entry: unknown, where: string): string {
  const e = asObject(entry);
  if (!e) throw new Error(`${where}: expected an object.`);
  const center = asObject(e.center);
  const lng = asNumber(center?.lng) ?? asNumber(e.lng) ?? asNumber(e.longitude);
  const lat = asNumber(center?.lat) ?? asNumber(e.lat) ?? asNumber(e.latitude);
  if (lng === undefined || lat === undefined) {
    throw new Error(`${where}: needs numeric lng/lat (or center: {lng, lat}).`);
  }
  const pin = asObject(e.pin);
  const zoom = e.zoomLevels ?? e.zoom;
  return [
    firstText(e.name, e.label),
    String(lng),
    String(lat),
    asText(e.notes),
    firstText(e.scalePresetId, e.scale),
    firstText(pin?.shape, e.pinShape),
    firstText(pin?.color, e.pinColor),
    Array.isArray(zoom) ? zoom.map(String).join("|") : asText(zoom),
  ]
    .map(csvField)
    .join(",");
}

/** The file's text as import CSV. Anything that does not open like JSON is already CSV. */
export function locationImportToCsv(text: string): string {
  const head = text.replace(/^\uFEFF/, "").trimStart();
  if (!head.startsWith("[") && !head.startsWith("{")) return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(head);
  } catch {
    throw new Error("That file is not valid JSON, so it could not be imported.");
  }
  const list = Array.isArray(parsed) ? parsed : asObject(parsed)?.locations;
  if (!Array.isArray(list)) {
    throw new Error("Locations JSON must be an array of locations or an object with a `locations` array.");
  }
  if (list.length === 0) throw new Error("Locations JSON contains no locations.");

  const rows = list.map((entry, i) => entryToCsvRow(entry, `locations[${i}]`));
  return `${[CSV_HEADER, ...rows].join("\n")}\n`;
}

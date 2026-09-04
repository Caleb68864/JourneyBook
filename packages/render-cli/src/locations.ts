/**
 * Locations-file loader for the headless CLI (`--locations <file>`).
 *
 * Accepts the same CSV the web importer takes (header row; `name`, `lng`, `lat`
 * required; `notes`, `scale` optional) plus CLI-only columns `pin`, `color`, and
 * `zoom` (a `|`-separated ladder of scale-preset ids → one page per level), and
 * a JSON form that tolerates both the engine's `RenderLocation` shape and the
 * web app's project-backup export (`{ project, locations: [{ name, lng, lat, … }] }`)
 * so a backed-up project can be rendered headless without reshaping.
 */

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { SCALE_PRESETS } from "@journeybook/atlas-core";
import type { RenderLocation } from "./render.js";

/** Minimal RFC4180-ish line splitter: double-quoted fields with "" escaping. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function indexOfAny(header: readonly string[], ...names: string[]): number {
  for (const name of names) {
    const idx = header.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

function nullIfEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertScaleId(id: string, where: string): string {
  if (!SCALE_PRESETS.some((p) => p.id === id)) {
    throw new Error(
      `${where}: unknown scale preset "${id}". Try one of: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`,
    );
  }
  return id;
}

/** Split a zoom ladder cell ("1-100000|1-50000|usgs-7-5-min", `;` also accepted). */
export function parseZoomLevels(value: string | undefined, where: string): string[] | undefined {
  const raw = nullIfEmpty(value);
  if (!raw) return undefined;
  const ids = raw.split(/[|;]/).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return undefined;
  return ids.map((id) => assertScaleId(id, where));
}

/**
 * Parse locations CSV text. Columns are matched by name, case-insensitively:
 * `name`, `lng|longitude|lon`, `lat|latitude` (required); `notes|note`,
 * `scale|scalePresetId|scaleId`, `pin|pinShape|shape`, `color|pinColor|colour`,
 * `zoom|zoomLevels|levels` (optional). Every bad row is reported; all-or-nothing.
 */
export function parseLocationsCsv(csv: string): RenderLocation[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.replace(/^﻿/, ""))
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Locations CSV is empty — expected a header row and at least one location.");
  }
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const nameIdx = indexOfAny(header, "name", "label");
  const lngIdx = indexOfAny(header, "lng", "longitude", "lon");
  const latIdx = indexOfAny(header, "lat", "latitude");
  const notesIdx = indexOfAny(header, "notes", "note");
  const scaleIdx = indexOfAny(header, "scale", "scalepresetid", "scaleid");
  const pinIdx = indexOfAny(header, "pin", "pinshape", "shape");
  const colorIdx = indexOfAny(header, "color", "pincolor", "colour");
  const zoomIdx = indexOfAny(header, "zoom", "zoomlevels", "levels");

  const missing: string[] = [];
  if (nameIdx < 0) missing.push("name");
  if (lngIdx < 0) missing.push("lng");
  if (latIdx < 0) missing.push("lat");
  if (missing.length > 0) {
    throw new Error(
      `Locations CSV header is missing required column(s): ${missing.join(", ")}. Expected: name, lng, lat[, notes][, scale][, pin][, color][, zoom].`,
    );
  }

  const out: RenderLocation[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    const rowNo = i + 1;
    const get = (idx: number) => (idx >= 0 ? (fields[idx] ?? "") : "");
    try {
      const name = get(nameIdx).trim();
      if (!name) throw new Error("name is required");
      const lng = Number(get(lngIdx).trim());
      const lat = Number(get(latIdx).trim());
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new Error(`lng must be a number in [-180, 180] (got "${get(lngIdx)}")`);
      }
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new Error(`lat must be a number in [-90, 90] (got "${get(latIdx)}")`);
      }
      const scaleId = nullIfEmpty(get(scaleIdx));
      const shape = nullIfEmpty(get(pinIdx));
      const color = nullIfEmpty(get(colorIdx));
      const loc: RenderLocation = {
        center: { lng, lat },
        label: name,
        ...(nullIfEmpty(get(notesIdx)) ? { notes: nullIfEmpty(get(notesIdx)) } : {}),
        ...(scaleId ? { scalePresetId: assertScaleId(scaleId, `row ${rowNo}`) } : {}),
        ...(shape || color ? { pin: { ...(shape ? { shape } : {}), ...(color ? { color } : {}) } } : {}),
      };
      const zoomLevels = parseZoomLevels(get(zoomIdx), `row ${rowNo}`);
      if (zoomLevels) loc.zoomLevels = zoomLevels;
      out.push(loc);
    } catch (err) {
      errors.push(`row ${rowNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Locations CSV failed (${errors.length} bad row(s)): ${errors.join("; ")}.`);
  }
  if (out.length === 0) {
    throw new Error("Locations CSV has a header but no location rows.");
  }
  return out;
}

type Loose = Record<string, unknown>;

function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/**
 * Normalise one JSON entry into a `RenderLocation`. Accepts the engine shape
 * (`{ center: {lng,lat}, label, scalePresetId, pin: {shape,color}, notes, zoomLevels }`)
 * and the web export shape (`{ name, lng, lat, scalePresetId, pinShape, pinColor, notes }`).
 */
export function normalizeLocationEntry(entry: unknown, where: string): RenderLocation {
  if (!entry || typeof entry !== "object") {
    throw new Error(`${where}: expected an object.`);
  }
  const e = entry as Loose;
  const center = (e["center"] && typeof e["center"] === "object" ? (e["center"] as Loose) : undefined);
  const lng = num(center?.["lng"]) ?? num(e["lng"]) ?? num(e["longitude"]);
  const lat = num(center?.["lat"]) ?? num(e["lat"]) ?? num(e["latitude"]);
  if (lng === undefined || lat === undefined || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`${where}: needs numeric lng/lat (or center: {lng, lat}).`);
  }
  // A web export carries both: `name` is the display name, `label` the L-series id.
  const label = str(e["name"]) ?? str(e["label"]);
  const scaleId = str(e["scalePresetId"]) ?? str(e["scale"]);
  const pinObj = e["pin"] && typeof e["pin"] === "object" ? (e["pin"] as Loose) : undefined;
  const shape = str(pinObj?.["shape"]) ?? str(e["pinShape"]);
  const color = str(pinObj?.["color"]) ?? str(e["pinColor"]);
  const notes = str(e["notes"]);

  const loc: RenderLocation = { center: { lng, lat } };
  if (label) loc.label = label;
  if (notes) loc.notes = notes;
  if (scaleId) loc.scalePresetId = assertScaleId(scaleId, where);
  if (shape || color) loc.pin = { ...(shape ? { shape } : {}), ...(color ? { color } : {}) };

  const zoomRaw = e["zoomLevels"] ?? e["zoom"];
  if (Array.isArray(zoomRaw)) {
    const ids = zoomRaw.map((z) => String(z).trim()).filter(Boolean);
    if (ids.length > 0) loc.zoomLevels = ids.map((id) => assertScaleId(id, where));
  } else if (typeof zoomRaw === "string") {
    const ids = parseZoomLevels(zoomRaw, where);
    if (ids) loc.zoomLevels = ids;
  }
  return loc;
}

/** Parse locations JSON: an array, or an object with a `locations` array (web backup). */
export function parseLocationsJson(text: string): RenderLocation[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Loose)["locations"])
      ? ((parsed as Loose)["locations"] as unknown[])
      : undefined;
  if (!list) {
    throw new Error("Locations JSON must be an array of locations or an object with a `locations` array.");
  }
  if (list.length === 0) throw new Error("Locations JSON contains no locations.");
  return list.map((entry, i) => normalizeLocationEntry(entry, `locations[${i}]`));
}

/** Load a `.csv` or `.json` locations file by extension. */
export function loadLocationsFile(path: string): RenderLocation[] {
  const text = readFileSync(path, "utf8");
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return parseLocationsJson(text);
  if (ext === ".csv" || ext === ".txt") return parseLocationsCsv(text);
  // Sniff: a leading `[` or `{` is JSON, anything else is CSV.
  const head = text.replace(/^﻿/, "").trimStart();
  return head.startsWith("[") || head.startsWith("{") ? parseLocationsJson(text) : parseLocationsCsv(text);
}

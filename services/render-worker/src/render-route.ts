import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { renderAtlas, tileBaseUrlError } from "@journeybook/render-cli";
import type { RenderAtlasInput } from "@journeybook/render-cli";

interface RenderWorkerOptions extends FastifyPluginOptions {
  generatedDir: string;
  /**
   * Root of the shared disk tile cache, or undefined to render without one.
   *
   * Deliberately an OPTION, not a body field. The engine's `RenderAtlasInput`
   * carries `cacheDir`, and this route used to spread the whole body into
   * `renderAtlas`, so a caller could name any absolute path and
   * `storeCachedTile` would `mkdir -p` it and fill it with tile bytes. Where a
   * process writes on its own filesystem is the operator's decision; it is not
   * a render parameter and it does not belong on the wire.
   */
  cacheDir?: string;
  /**
   * Base URLs this worker may be pointed at for basemap tiles, from
   * `TILE_BASE_URL_ALLOWLIST`.
   *
   * Also an OPERATOR setting, for the same reason as {@link cacheDir}: which
   * hosts this process may issue requests to is a deployment decision, and the
   * request body is the one place it must not come from.
   *
   * Empty means "no allowlist configured" — NOT "permit nothing". The weaker
   * rules in `tile-url.ts` (scheme, credentials, non-routable literals) still
   * apply, and an operator who wants a real destination control sets this. The
   * distinction matters: reading an unset variable as an empty allowlist would
   * refuse every tile-proxied render on any deployment that had not yet been
   * told about this setting, which is the whole failure mode of adding a guard.
   */
  tileBaseUrlAllowlist?: readonly string[];
}

/**
 * JSON Schema for `POST /render` — the engine's `RenderAtlasInput` as a wire
 * contract, minus `cacheDir` (see {@link RenderWorkerOptions.cacheDir}).
 *
 * Why a schema at all, when `renderAtlas` already validates: the engine
 * validates the fields it knows about, in the middle of a render, and the route
 * then string-matches the resulting message to pick an HTTP status. A schema
 * refuses a malformed body at the boundary, before a single tile is fetched,
 * and — with the unknown-key check below — makes the set of accepted fields an
 * explicit list instead of "whatever the engine's interface happens to have".
 *
 * The bounds mirror the engine's own (`validateInput` in `render.ts`) rather
 * than inventing stricter ones: two components with two different definitions
 * of a valid request is the failure this is meant to remove, not add.
 */
const centerSchema = {
  type: "object",
  required: ["lng", "lat"],
  additionalProperties: false,
  properties: {
    lng: { type: "number", minimum: -180, maximum: 180 },
    lat: { type: "number", minimum: -90, maximum: 90 },
  },
} as const;

const renderBodySchema = {
  type: "object",
  required: ["mode", "scalePresetId", "tier", "outputPath"],
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["bbox", "location"] },
    bbox: { type: "array", minItems: 4, maxItems: 4, items: { type: "number" } },
    center: centerSchema,
    locations: {
      type: "array",
      items: {
        type: "object",
        required: ["center"],
        additionalProperties: false,
        properties: {
          center: centerSchema,
          label: { type: "string" },
          scalePresetId: { type: "string", minLength: 1 },
          pin: {
            type: "object",
            additionalProperties: false,
            properties: { shape: { type: "string" }, color: { type: "string" } },
          },
          notes: { type: "string" },
          zoomLevels: { type: "array", items: { type: "string", minLength: 1 } },
        },
      },
    },
    scalePresetId: { type: "string", minLength: 1 },
    tier: { type: "integer", minimum: 1, maximum: 4 },
    overlap: { type: "number", minimum: 0, exclusiveMaximum: 1 },
    margins: {
      type: "object",
      required: ["top", "right", "bottom", "left"],
      additionalProperties: false,
      properties: {
        top: { type: "number", minimum: 0 },
        right: { type: "number", minimum: 0 },
        bottom: { type: "number", minimum: 0 },
        left: { type: "number", minimum: 0 },
        gutter: { type: "number", minimum: 0 },
      },
    },
    orientation: { type: "string", enum: ["portrait", "landscape"] },
    title: { type: "string" },
    basemap: { type: "boolean" },
    // Cheap shape check here; the real judgement is `tileBaseUrlError` in the
    // handler, which parses the URL (so every alternative spelling of an IP
    // literal is normalised first), refuses embedded credentials and
    // non-routable destinations, and applies the operator's allowlist. A JSON
    // Schema pattern cannot do any of that, and this one used to be the ONLY
    // check — which made the worker an open outbound fetch for anything that
    // could reach it.
    tileBaseUrl: { type: "string", pattern: "^https?://" },
    tileSourceId: { type: "string", minLength: 1 },
    tileMaxZoom: { type: "integer", minimum: 0, maximum: 24 },
    outputPath: { type: "string", minLength: 1 },
    route: { type: "boolean" },
    landmarks: {
      type: "array",
      items: {
        type: "object",
        required: ["lng", "lat", "name", "category", "score"],
        additionalProperties: false,
        properties: {
          lng: { type: "number", minimum: -180, maximum: 180 },
          lat: { type: "number", minimum: -90, maximum: 90 },
          name: { type: "string" },
          category: { type: "string" },
          score: { type: "number" },
        },
      },
    },
    tableOfContents: { type: "boolean" },
    overview: { type: "boolean" },
    referenceGrid: { type: "boolean" },
    notes: { type: "boolean" },
    zoomLevels: { type: "array", items: { type: "string", minLength: 1 } },
    cover: { type: "boolean" },
    coverPadFraction: { type: "number", minimum: 0, maximum: 1 },
    panelWidthPx: { type: "integer", minimum: 256, maximum: 8000 },
    panelFormat: { type: "string", enum: ["jpeg", "png"] },
    panelQuality: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

/**
 * The accepted field names, read off the schema itself.
 *
 * Fastify's ajv runs with `removeAdditional: true`, so `additionalProperties:
 * false` on the body would silently DELETE an unknown field rather than refuse
 * it. Silent deletion is safe (`cacheDir` never reaches the engine either way)
 * and useless to operate: an API sending a field the worker quietly drops looks
 * exactly like an API sending nothing, which is the disagreement this is here to
 * end. So the unknown keys are named back to the caller, from the same list the
 * schema is built from — one definition of "accepted", not two.
 */
const ACCEPTED_FIELDS: ReadonlySet<string> = new Set(Object.keys(renderBodySchema.properties));

function isUpstreamError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const code = (err as NodeJS.ErrnoException).code ?? "";
  return (
    msg.includes("fetch") ||
    msg.includes("tile") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("ehostunreach") ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH"
  );
}

function isInputError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.startsWith("Invalid ") ||
    msg.startsWith("Unknown scalePresetId") ||
    msg.includes('requires center') ||
    msg.includes('requires bbox') ||
    msg.includes('requires ')
  );
}

export async function renderRoute(app: FastifyInstance, opts: RenderWorkerOptions): Promise<void> {
  const generatedDir = path.resolve(opts.generatedDir);
  const cacheDir = opts.cacheDir ? path.resolve(opts.cacheDir) : undefined;
  const tileBaseUrlAllowlist = opts.tileBaseUrlAllowlist ?? [];

  app.addHook("preValidation", async (req, reply) => {
    if (req.method !== "POST" || req.url.split("?")[0] !== "/render") return;
    if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) return;
    const unknown = Object.keys(req.body).filter((key) => !ACCEPTED_FIELDS.has(key));
    if (unknown.length > 0) {
      return reply.status(400).send({
        error: `Invalid render request: unsupported field(s) ${unknown.join(", ")}.`,
      });
    }
  });

  app.post("/render", { schema: { body: renderBodySchema }, attachValidation: true }, async (req, reply) => {
    if (req.validationError) {
      // One error shape for the route. Fastify's default validation reply is
      // `{ statusCode, error: "Bad Request", message }`, whose `error` says
      // nothing about what was wrong; every other 400 here is `{ error: <why> }`.
      return reply
        .status(400)
        .send({ error: `Invalid render request: ${req.validationError.message}` });
    }

    const body = req.body as Partial<RenderAtlasInput>;

    if (body.mode === "location" && !body.center) {
      return reply.status(400).send({ error: 'mode "location" requires center' });
    }
    if (body.mode === "bbox" && !body.bbox) {
      return reply.status(400).send({ error: 'mode "bbox" requires bbox' });
    }

    // Where this process may issue an outbound request, judged before a single
    // tile is fetched. `refuseNonRoutableHosts` is set HERE and nowhere else:
    // the caller of this route is whoever can reach the port, not the operator.
    const tileUrlError = tileBaseUrlError(body.tileBaseUrl, {
      allowlist: tileBaseUrlAllowlist,
      refuseNonRoutableHosts: true,
    });
    if (tileUrlError !== null) {
      return reply.status(400).send({ error: tileUrlError });
    }

    // The schema makes outputPath required and non-empty; this narrows the type
    // without asserting, so a future schema edit that drops it fails here rather
    // than resolving `undefined` against the generated directory.
    if (typeof body.outputPath !== "string") {
      return reply.status(400).send({ error: "Invalid render request: outputPath is required." });
    }
    const requestedRelPath: string = body.outputPath;

    // Reject absolute paths and traversal attempts
    if (path.isAbsolute(requestedRelPath)) {
      return reply.status(400).send({ error: "outputPath must be a relative path" });
    }

    const fullOutputPath = path.resolve(generatedDir, requestedRelPath);
    const normalizedDir = generatedDir.endsWith(path.sep) ? generatedDir : generatedDir + path.sep;

    if (!fullOutputPath.startsWith(normalizedDir)) {
      return reply.status(400).send({ error: "outputPath traversal rejected" });
    }

    await fs.promises.mkdir(path.dirname(fullOutputPath), { recursive: true });

    const start = Date.now();
    let outcome: "success" | "error" = "error";

    try {
      const result = await renderAtlas({
        ...(body as RenderAtlasInput),
        outputPath: fullOutputPath,
        // Both of these overwrite whatever the body said, and neither is
        // reachable from the wire (outputPath is confined above; cacheDir is
        // refused by the schema). Set last so the spread cannot win.
        ...(cacheDir ? { cacheDir } : {}),
      });
      outcome = "success";
      const elapsedMs = Date.now() - start;

      app.log.info({
        outputPath: requestedRelPath,
        pageCount: result.pageCount,
        mode: body.mode,
        scalePresetId: body.scalePresetId,
        tier: body.tier,
        outcome,
        elapsedMs,
      });

      return reply.status(200).send({
        outputPath: requestedRelPath,
        pageCount: result.pageCount,
        attribution: result.attribution,
      });
    } catch (err) {
      const elapsedMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      app.log.info({
        outputPath: requestedRelPath,
        mode: body.mode,
        scalePresetId: body.scalePresetId,
        tier: body.tier,
        outcome,
        elapsedMs,
        error: message,
      });

      if (isInputError(err)) {
        return reply.status(400).send({ error: message });
      }
      if (isUpstreamError(err)) {
        return reply.status(502).send({ error: message });
      }

      app.log.error({ err }, "Unexpected render error");
      return reply.status(500).send({ error: "Internal render error" });
    }
  });
}

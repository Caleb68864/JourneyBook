import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { renderAtlas, assembleContract, tileBaseUrlError, RenderCancelledError } from "@journeybook/render-cli";
import type { RenderAtlasInput } from "@journeybook/render-cli";
import { JobStore, type JobErrorKind } from "./jobs.js";

interface RenderWorkerOptions extends FastifyPluginOptions {
  generatedDir: string;
  /**
   * Job registry. Supplied by `server.ts` so the process can abort everything on
   * SIGTERM; tests pass their own to control the clock.
   */
  jobs?: JobStore;
  /**
   * Most renders in flight at once. The worker used to be back-pressured by the
   * HTTP connection itself — one request, one render, held open — and the job
   * protocol removes that for free. The API sends one at a time (ADR 0006), so
   * this is a bound against anything else that can reach the port, not a
   * concurrency policy.
   */
  maxActiveJobs?: number;
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
export const ACCEPTED_RENDER_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(renderBodySchema.properties),
);

/** @deprecated internal alias kept so the handler below reads as it did. */
const ACCEPTED_FIELDS = ACCEPTED_RENDER_FIELDS;

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

/**
 * Classify a render failure ONCE, at the catch that saw the exception, while the
 * exception's type is still available.
 *
 * The substring matching below is still here because the engine's errors are
 * strings; what changed is that the answer is recorded on the job as a field
 * rather than re-derived from a message two processes downstream. A cancel is
 * decided by type, not by text, which is the case that kept being misreported.
 */
function classify(err: unknown): JobErrorKind {
  if (err instanceof RenderCancelledError) return "cancelled";
  if (isInputError(err)) return "input";
  if (isUpstreamError(err)) return "upstream";
  return "internal";
}

export async function renderRoute(app: FastifyInstance, opts: RenderWorkerOptions): Promise<void> {
  const generatedDir = path.resolve(opts.generatedDir);
  const cacheDir = opts.cacheDir ? path.resolve(opts.cacheDir) : undefined;
  const tileBaseUrlAllowlist = opts.tileBaseUrlAllowlist ?? [];
  const jobs = opts.jobs ?? new JobStore();
  const maxActiveJobs = opts.maxActiveJobs ?? 4;

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

    // Derive the contract HERE, synchronously, before a job exists.
    //
    // `assembleContract` is pure geometry — no I/O — and it is where every input
    // error the engine can name lives: an unknown scale preset, a bbox that is
    // not a bbox, margins that leave no printable map box, an extent over
    // MAX_ATLAS_PAGES. Running it at the boundary keeps all of those a 400 on
    // this request, with the engine's own wording, instead of a 202 followed by
    // a job that fails a moment later and has to be gone and read. The render
    // repeats the work; it is milliseconds of arithmetic against minutes of tile
    // fetching, and the alternative is two definitions of a valid request.
    try {
      assembleContract(body as RenderAtlasInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isInputError(err)) {
        return reply.status(400).send({ error: message });
      }
      app.log.error({ err }, "Contract assembly failed for a request that passed the schema");
      return reply.status(500).send({ error: "Internal render error" });
    }

    if (jobs.activeCount() >= maxActiveJobs) {
      return reply.status(429).send({
        error: `Render worker is already running ${maxActiveJobs} jobs; retry when one finishes.`,
      });
    }

    await fs.promises.mkdir(path.dirname(fullOutputPath), { recursive: true });

    const { id: jobId, signal } = jobs.create();
    const start = Date.now();

    // Detached on purpose: the response below is the acceptance, not the result.
    // Nothing awaits this promise, so its rejection has to be handled here or it
    // becomes an unhandled rejection that takes the process down — every path
    // through the catch records the outcome on the job.
    void (async () => {
      try {
        const result = await renderAtlas({
          ...(body as RenderAtlasInput),
          outputPath: fullOutputPath,
          // Both of these overwrite whatever the body said, and neither is
          // reachable from the wire (outputPath is confined above; cacheDir is
          // refused by the schema). Set last so the spread cannot win.
          ...(cacheDir ? { cacheDir } : {}),
          onProgress: (p) => jobs.progress(jobId, p),
          signal,
        });

        jobs.complete(
          jobId,
          requestedRelPath,
          result.pageCount,
          result.attribution,
          result.deliveredDpi,
        );
        app.log.info({
          jobId,
          outputPath: requestedRelPath,
          pageCount: result.pageCount,
          deliveredDpi: result.deliveredDpi,
          mode: body.mode,
          scalePresetId: body.scalePresetId,
          tier: body.tier,
          outcome: "success",
          elapsedMs: Date.now() - start,
        });
      } catch (err) {
        const kind = classify(err);
        const message = err instanceof Error ? err.message : String(err);
        jobs.fail(jobId, kind, message);
        app.log.info({
          jobId,
          outputPath: requestedRelPath,
          mode: body.mode,
          scalePresetId: body.scalePresetId,
          tier: body.tier,
          outcome: kind === "cancelled" ? "cancelled" : "error",
          errorKind: kind,
          elapsedMs: Date.now() - start,
          error: message,
        });
        if (kind === "internal") app.log.error({ err }, "Unexpected render error");
      }
    })();

    // 202, and a Location naming the job. The body that used to come back here —
    // outputPath, pageCount, attribution — is now on the job record, because it
    // does not exist yet at the moment this reply is written.
    return reply
      .status(202)
      .header("Location", `/jobs/${jobId}`)
      .send({ jobId, state: "rendering", statusUrl: `/jobs/${jobId}` });
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const record = jobs.get(req.params.id);
    if (!record) {
      // A job this worker has never heard of, or one whose retention window has
      // passed, or one that died with a previous process. All three are "this
      // worker cannot tell you", which is true — and is exactly what a persisted
      // "still rendering" row would have got wrong.
      return reply.status(404).send({ error: `No render job ${req.params.id}.` });
    }
    return reply.status(200).send(record);
  });

  app.delete<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const record = jobs.cancel(req.params.id);
    if (!record) {
      return reply.status(404).send({ error: `No render job ${req.params.id}.` });
    }
    // 200 with the record rather than 204: a cancel that arrives after the render
    // completed has not cancelled anything, and the caller needs to be able to
    // see that rather than assume it.
    return reply.status(200).send(record);
  });
}

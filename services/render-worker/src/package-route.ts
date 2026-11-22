import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { buildRasterPackage, tileBaseUrlError, DEFAULT_PACKAGE_MAX_TILES } from "@journeybook/render-cli";

/**
 * `POST /package` and `GET /package-jobs/:id`: build a raster PMTiles package (Stage 7, owner
 * decision b) as a job, the way `/render` builds an atlas. The engine's `buildRasterPackage`
 * does the work: tile enumeration is TS geometry (ADR 0004), so the API asks for a package
 * here rather than computing one.
 *
 * The archive is written to `packagesDir` (an operator setting, like `generatedDir`), under a
 * name the caller chooses but cannot escape, and never over an existing file: a package is
 * something an atlas may already be printing from. It is written to a temp name and renamed,
 * so a reader never sees half an archive.
 */

interface PackageRouteOptions extends FastifyPluginOptions {
  /** Where packages are written; undefined means this worker does not make packages (503). */
  packagesDir?: string;
  tileBaseUrlAllowlist?: readonly string[];
  /** Finished jobs stay readable this long. Default 1 hour: a package can take a while to collect. */
  retentionMs?: number;
}

export type PackageJobState = "packaging" | "completed" | "failed";

export interface PackageJobRecord {
  id: string;
  state: PackageJobState;
  /** The archive's path relative to the packages folder. */
  outputName: string;
  tiles?: number;
  bytes?: number;
  tileType?: string;
  error?: string;
}

const bodySchema = {
  type: "object",
  required: ["bbox", "minZoom", "maxZoom", "outputName"],
  additionalProperties: false,
  properties: {
    bbox: { type: "array", minItems: 4, maxItems: 4, items: { type: "number" } },
    minZoom: { type: "integer", minimum: 0, maximum: 24 },
    maxZoom: { type: "integer", minimum: 0, maximum: 24 },
    outputName: { type: "string", minLength: 1, maxLength: 200, pattern: "\\.pmtiles$" },
    tileBaseUrl: { type: "string", pattern: "^https?://" },
    tileSourceId: { type: "string", minLength: 1 },
    maxTiles: { type: "integer", minimum: 1 },
  },
} as const;

interface PackageBody {
  bbox: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  outputName: string;
  tileBaseUrl?: string;
  tileSourceId?: string;
  maxTiles?: number;
}

export async function packageRoute(app: FastifyInstance, opts: PackageRouteOptions): Promise<void> {
  const packagesDir = opts.packagesDir ? path.resolve(opts.packagesDir) : undefined;
  const allowlist = opts.tileBaseUrlAllowlist ?? [];
  const retentionMs = opts.retentionMs ?? 60 * 60 * 1000;
  const jobs = new Map<string, { record: PackageJobRecord; finishedAt?: number }>();

  const sweep = () => {
    const now = Date.now();
    for (const [id, job] of jobs) if (job.finishedAt !== undefined && now - job.finishedAt > retentionMs) jobs.delete(id);
  };

  app.post("/package", { schema: { body: bodySchema }, attachValidation: true }, async (req, reply) => {
    if (req.validationError) {
      return reply.status(400).send({ error: `Invalid package request: ${req.validationError.message}` });
    }
    if (!packagesDir) {
      return reply.status(503).send({ error: "This worker makes no packages: PACKAGES_DIR is not set." });
    }
    const body = req.body as PackageBody;
    const urlError = tileBaseUrlError(body.tileBaseUrl, { allowlist, refuseNonRoutableHosts: true });
    if (urlError !== null) return reply.status(400).send({ error: urlError });

    const full = path.resolve(packagesDir, body.outputName);
    const rootSep = packagesDir.endsWith(path.sep) ? packagesDir : packagesDir + path.sep;
    if (path.isAbsolute(body.outputName) || !full.startsWith(rootSep)) {
      return reply.status(400).send({ error: "outputName must stay inside the packages folder" });
    }
    if (fs.existsSync(full) || [...jobs.values()].some((j) => j.record.state === "packaging" && j.record.outputName === body.outputName)) {
      return reply.status(409).send({ error: `A package named ${body.outputName} already exists or is being made.` });
    }

    sweep();
    const id = randomUUID();
    const record: PackageJobRecord = { id, state: "packaging", outputName: body.outputName };
    const job: { record: PackageJobRecord; finishedAt?: number } = { record };
    jobs.set(id, job);

    void (async () => {
      const temp = `${full}.tmp-${id}`;
      try {
        const result = await buildRasterPackage({
          bbox: body.bbox,
          minZoom: body.minZoom,
          maxZoom: body.maxZoom,
          maxTiles: body.maxTiles ?? DEFAULT_PACKAGE_MAX_TILES,
          ...(body.tileBaseUrl ? { tileBaseUrl: body.tileBaseUrl } : {}),
          ...(body.tileSourceId ? { sourceId: body.tileSourceId } : {}),
        });
        await fs.promises.mkdir(path.dirname(full), { recursive: true });
        await fs.promises.writeFile(temp, result.archive, { flag: "wx" });
        // link, not rename: rename replaces whatever is at `full`, so a package copied in (or
        // made by another route) while this one was fetching would have been overwritten. The
        // existence check above is only advice; link fails with EEXIST, atomically.
        try {
          await fs.promises.link(temp, full);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`A package named ${body.outputName} appeared while this one was being made; it was left as it was.`);
          }
          throw err;
        } finally {
          await fs.promises.rm(temp, { force: true });
        }
        job.record = { ...record, state: "completed", tiles: result.plan.tiles, bytes: result.archive.length, tileType: result.tileType };
        app.log.info({ jobId: id, outputName: body.outputName, tiles: result.plan.tiles }, "package written");
      } catch (err) {
        await fs.promises.rm(temp, { force: true }).catch(() => undefined);
        const message = err instanceof Error ? err.message : String(err);
        job.record = { ...record, state: "failed", error: message };
        app.log.warn({ jobId: id, outputName: body.outputName, error: message }, "package failed");
      } finally {
        job.finishedAt = Date.now();
      }
    })();

    return reply.status(202).header("Location", `/package-jobs/${id}`).send(record);
  });

  app.get<{ Params: { id: string } }>("/package-jobs/:id", async (req, reply) => {
    sweep();
    const job = jobs.get(req.params.id);
    if (!job) return reply.status(404).send({ error: `No package job ${req.params.id}.` });
    return reply.status(200).send(job.record);
  });
}

import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { renderAtlas } from "@journeybook/render-cli";
import type { RenderAtlasInput } from "@journeybook/render-cli";

interface RenderWorkerOptions extends FastifyPluginOptions {
  generatedDir: string;
}

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
    msg.startsWith("Unknown scalePresetId") ||
    msg.includes('requires center') ||
    msg.includes('requires bbox') ||
    msg.includes('requires ')
  );
}

export async function renderRoute(app: FastifyInstance, opts: RenderWorkerOptions): Promise<void> {
  const generatedDir = path.resolve(opts.generatedDir);

  app.post("/render", async (req, reply) => {
    const body = req.body as Partial<RenderAtlasInput>;

    if (!body.mode || !body.scalePresetId || body.tier === undefined || !body.outputPath) {
      return reply.status(400).send({ error: "Missing required fields: mode, scalePresetId, tier, outputPath" });
    }
    if (body.mode === "location" && !body.center) {
      return reply.status(400).send({ error: 'mode "location" requires center' });
    }
    if (body.mode === "bbox" && !body.bbox) {
      return reply.status(400).send({ error: 'mode "bbox" requires bbox' });
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
      const result = await renderAtlas({ ...(body as RenderAtlasInput), outputPath: fullOutputPath });
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

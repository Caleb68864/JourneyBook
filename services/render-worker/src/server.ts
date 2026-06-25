import fs from "node:fs";
import Fastify from "fastify";
import { renderRoute } from "./render-route.js";

const parsedPort = Number.parseInt(process.env["PORT"] ?? "8090", 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 8090;
const GENERATED_DIR = process.env["GENERATED_DIR"] ?? "data/generated";

// Cap request bodies (render inputs are tiny) and bound request time so a stalled
// upstream tile fetch can't pin a connection open forever.
const app = Fastify({
  logger: true,
  bodyLimit: 64 * 1024,
  requestTimeout: 120_000,
});

app.get("/health", async (_req, _reply) => {
  return { status: "ok" };
});

await app.register(renderRoute, { generatedDir: GENERATED_DIR });

async function start(): Promise<void> {
  try {
    // Fail fast at startup if the artifact directory can't be created, rather
    // than turning every render into an opaque 500.
    await fs.promises.mkdir(GENERATED_DIR, { recursive: true });
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error({ err }, "render-worker failed to start");
    process.exit(1);
  }
}

// Graceful shutdown so in-flight renders can drain on container stop.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down render-worker");
    void app.close().then(() => process.exit(0));
  });
}

await start();

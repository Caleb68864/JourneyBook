import fs from "node:fs";
import Fastify from "fastify";
import { parseTileBaseUrlAllowlist } from "@journeybook/render-cli";
import { renderRoute } from "./render-route.js";

const parsedPort = Number.parseInt(process.env["PORT"] ?? "8090", 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 8090;
const GENERATED_DIR = process.env["GENERATED_DIR"] ?? "data/generated";
// Where this process may write tile bytes — an operator setting, never a request
// field. Unset means "render without a disk cache", which is what the deployed
// topology does today: `docker-compose.yml` mounts no cache into the worker and
// the C# proxy owns the shared cache.
const TILE_CACHE_DIR = process.env["TILE_CACHE_DIR"];
// Which tile base URLs this worker may be pointed at, comma- or
// whitespace-separated. An operator setting for the same reason as
// TILE_CACHE_DIR: the request body must not choose where this process sends
// outbound HTTP. Unset means no allowlist — the weaker structural rules in
// `tile-url.ts` still apply. `infra/compose/docker-compose.yml` sets it to the
// api's tile proxy, which is the only destination the API ever sends.
const TILE_BASE_URL_ALLOWLIST = parseTileBaseUrlAllowlist(process.env["TILE_BASE_URL_ALLOWLIST"]);

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

await app.register(renderRoute, {
  generatedDir: GENERATED_DIR,
  ...(TILE_CACHE_DIR ? { cacheDir: TILE_CACHE_DIR } : {}),
  tileBaseUrlAllowlist: TILE_BASE_URL_ALLOWLIST,
});

app.log.info(
  { tileBaseUrlAllowlist: TILE_BASE_URL_ALLOWLIST },
  TILE_BASE_URL_ALLOWLIST.length > 0
    ? "tile base URL allowlist active"
    : "no TILE_BASE_URL_ALLOWLIST set — any routable http(s) tile base is accepted",
);

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

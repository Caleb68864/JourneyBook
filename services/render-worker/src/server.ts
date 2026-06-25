import Fastify from "fastify";
import { renderRoute } from "./render-route.js";

const PORT = parseInt(process.env["PORT"] ?? "8090", 10);
const GENERATED_DIR = process.env["GENERATED_DIR"] ?? "data/generated";

const app = Fastify({ logger: true });

app.get("/health", async (_req, _reply) => {
  return { status: "ok" };
});

await app.register(renderRoute, { generatedDir: GENERATED_DIR });

await app.listen({ port: PORT, host: "0.0.0.0" });

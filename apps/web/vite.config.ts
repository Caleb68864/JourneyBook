import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// In dev, proxy API calls to the ASP.NET Core service so the browser can use
// same-origin relative URLs (/health, /api/*). Override the target with
// VITE_API_PROXY. In production the web container's reverse proxy does this.
const apiProxyTarget = process.env.VITE_API_PROXY ?? "http://localhost:5180";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // `jsdom` is available so a control can be tested the way a user reaches it:
  // render it, change it, and assert on the request that leaves. Every test here
  // used to be a pure function or a stubbed fetch, which is exactly how a
  // control that is declared but not wired stays green — the mapping is right
  // and nothing calls it.
  //
  // It is opted into PER FILE (`// @vitest-environment jsdom` at the top), not
  // set globally, and that was measured rather than assumed: switching the whole
  // project to jsdom broke `a11y.test.ts` and `theme-tokens.test.ts`, which walk
  // the source tree from `import.meta.url` — under jsdom that is an http URL and
  // `fileURLToPath` refuses it. Two source-scanning tests lost to a default is
  // not a trade worth making for a runtime only a handful of files need.
  //
  // Note for DOM tests: `maplibre-gl` cannot initialise under jsdom, so
  // `MapPreview` — and `ProjectEditorPage`, which imports it — must not be
  // pulled into one. Test the controls themselves; they are small on purpose.
  //
  // There is deliberately no `test` block here: this file is typechecked as a
  // plain Vite config (`tsc -b` includes it), and Vitest's options are not on
  // `UserConfig` without pulling in `vitest/config`. Per-file pragmas need
  // neither.
  server: {
    port: 5173,
    proxy: {
      "/health": { target: apiProxyTarget, changeOrigin: true },
      "/api": { target: apiProxyTarget, changeOrigin: true },
    },
  },
});

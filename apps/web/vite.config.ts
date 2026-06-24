import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, proxy API calls to the ASP.NET Core service so the browser can use
// same-origin relative URLs (/health, /api/*). Override the target with
// VITE_API_PROXY. In production the web container's reverse proxy does this.
const apiProxyTarget = process.env.VITE_API_PROXY ?? "http://localhost:5180";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/health": { target: apiProxyTarget, changeOrigin: true },
      "/api": { target: apiProxyTarget, changeOrigin: true },
    },
  },
});

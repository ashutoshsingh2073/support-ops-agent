/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend has no CORS headers, so in development every call goes to /api on
// the Vite server and is proxied to Express. In production, serve the built
// files behind the same reverse proxy, or set VITE_API_BASE.
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, "apps/web"),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/media": "http://localhost:8787"
    }
  }
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The adapter serves the built SPA in production, so dev-mode proxying keeps
// the same origin and identical fetch paths in both modes.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9201,
    proxy: { "/api": "http://127.0.0.1:9200" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

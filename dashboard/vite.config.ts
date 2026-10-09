import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Dev: `npm run dev` proxies API calls to a server started with `huddle-server serve`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5180,
    proxy: { "/api": "http://127.0.0.1:48731", "/engine": "http://127.0.0.1:48731", "/health": "http://127.0.0.1:48731" },
  },
  build: { outDir: process.env.OUT_DIR ?? "dist", emptyOutDir: true },
});

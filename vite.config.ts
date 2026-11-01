import { writeFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { manifestText, normalizeBase, serviceWorkerSource } from "./src/pwa";

const base = normalizeBase(process.env.VITE_BASE);

export default defineConfig({
  // Relative by default so the Mac app works from file://.
  // GitHub Pages sets VITE_BASE=/mitosis/.
  base,
  plugins: [
    react(),
    {
      name: "emit-pwa",
      apply: "build",
      closeBundle() {
        writeFileSync("dist/manifest.webmanifest", manifestText(base));
        writeFileSync("dist/sw.js", serviceWorkerSource(base));
      },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

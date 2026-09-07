import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      external: ["electron", "electron/renderer", "electron/common"],
      output: {
        entryFileNames: "preload.js",
      },
    },
  },
});

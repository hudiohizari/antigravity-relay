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
      external: [
        "electron",
        "electron/main",
        "electron/common",
        "ws",
        "bufferutil",
        "utf-8-validate",
      ],
      output: {
        entryFileNames: "main.js",
      },
    },
  },
});

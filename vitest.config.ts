import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "src/main/account-store/**",
        "src/main/ipc/**",
        "src/main/oauth/**",
        "src/main/process/**",
        "src/main/quota/**",
        "src/main/relay/**",
        "src/main/switcher/**",
        "src/main/snapshots/**",
        "src/main/tunnel/**",
        "src/main/settings/**",
        "src/main/tray/**",
        "src/main/notifications/**",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 90,
        statements: 100,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

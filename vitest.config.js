import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["server/**/*.js"],
      exclude: ["server/loadEnv.js", "server/kanban.js"]
    }
  }
});

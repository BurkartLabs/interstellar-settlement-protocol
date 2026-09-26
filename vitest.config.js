import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.js"],
    globalSetup: ["tests/globalSetup.js"],
    setupFiles: ["tests/setup.js"],
    // Bug #2055: integration files boot the server in beforeAll; under CPU load that import outlasts the 10s default.
    hookTimeout: 30_000,
    // Bug #2051: the same load pushes ordinary integration tests (register, log in, a few requests) past the 5s default.
    // Which files fail changes every run, so the margin is global. A hung test now fails at 20s instead of 5s.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["server/**/*.js"],
      exclude: ["server/loadEnv.js", "server/kanban.js"]
    }
  }
});

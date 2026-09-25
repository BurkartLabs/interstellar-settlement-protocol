// ISP-61 (AB#747): the first-hour playtest. Run against a server you already started (npm start / npm run dev),
// pointed at with BASE_URL; defaults to the port the server itself defaults to (server/index.js).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:3000",
    trace: "off"
  }
});

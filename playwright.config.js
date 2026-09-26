// ISP-61 (AB#747): the first-hour playtest. Run against a server you already started, pointed at with BASE_URL;
// defaults to the port the server itself defaults to (server/index.js). Start it as
//   ISP_DEV=1 NODE_ENV=test npm run dev
// ISP_DEV=1 gives the test outbox the specs verify their players through (AB#2288); NODE_ENV=test lifts the rate
// limits, which a whole run passes in minutes: without it every registration after the fifth in an hour is refused
// (Bug AB#2326). Specs that start their own server set what they need.
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

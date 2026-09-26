// AB#1815: server/index.js was split into server/routes/*.js and five server/*.js modules. A test that read index.js
// as "the server's route code" reads all of them now — reading index.js alone would leave its scan passing on a file
// with no routes left in it, checking nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// AB#1054: marketSettlement.js holds the buy route's settlement, taken out of server/routes/market.js, and buyOrders.js
// the buy orders that settle the same way; a scan of route code (trade-history types, io.emit) covers them too.
const SPLIT_FROM_INDEX = ["server/index.js", "server/app.js", "server/auth.js", "server/travel.js", "server/ticks.js", "server/realtime.js", "server/marketSettlement.js", "server/buyOrders.js"];

/** Repo-relative paths of every file that was server/index.js, route modules included (new ones too). */
export function serverCodeFiles() {
  const routes = fs.readdirSync(path.join(ROOT, "server/routes")).filter((f) => f.endsWith(".js")).sort().map((f) => `server/routes/${f}`);
  return [...SPLIT_FROM_INDEX, ...routes];
}

export const readServerFile = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/** All of that code as one string, for scans that look for a literal anywhere in it. */
export function serverCode() {
  return serverCodeFiles().map(readServerFile).join("\n");
}

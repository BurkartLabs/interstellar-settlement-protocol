// The Economy Planner's local server (AB#4911): `npm run planner`, then open the address it prints. A developer tool,
// never deployed: it serves tools/planner/, the game's pure rule modules in public/scripts/ (which the planner
// imports, so it runs the game's own arithmetic), and /rules.json, built from this checkout's data files on every
// request so an edit to data/economy.json shows on a reload. Plans live in the browser (and export as JSON).
//
// Usage: npm run planner   (PLANNER_PORT, default 4500)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "../tools/planner/rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PLANNER_PORT || 4500);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
// Only these trees are served: the planner and the game's browser modules. Nothing else in the checkout is reachable.
const SERVED = ["tools/planner", "public/scripts", "public/vendor"];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/" || url.pathname === "/tools/planner") { res.writeHead(302, { Location: "/tools/planner/" }); return res.end(); }
  if (url.pathname === "/rules.json") {
    try {
      const body = JSON.stringify(loadRules());
      res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
      return res.end(body);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      return res.end(`could not read the rules: ${error.message}`);
    }
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(ROOT, rel);
  const allowed = SERVED.some((dir) => file.startsWith(path.resolve(ROOT, dir) + path.sep));
  if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => console.log(`Economy Planner: http://127.0.0.1:${PORT}/tools/planner/`));

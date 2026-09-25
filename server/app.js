// server/app.js: the Express app, its HTTP server and socket.io, created once and shared, split out of server/index.js (AB#1815).
import "./loadEnv.js";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

// TODO(AB#737): Move this to a single file so that we aren't redefining it everywhere
const IS_DEV = !process.env.NODE_ENV || process.env.NODE_ENV !== "production";
// The developer surface (the shared demo account's login and reset, and the kanban board) exists only when the
// environment asks for it: ISP_DEV=1, and never in production. It used to be a literal true, so it was live on every
// server (Bug #423, Bug #1069). Unset, the routes are not registered at all.
const DEV_SURFACE = process.env.ISP_DEV === "1" && process.env.NODE_ENV !== "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { version: APP_VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

const app = express();
// AB#735: responses do not name the framework they come from.
app.disable("x-powered-by");
// ISP-64: trust exactly one hop — the Container Apps ingress in front of this server — so X-Forwarded-For's
// rightmost entry is the real client address and nothing a client prepends ahead of it can move the count.
app.set("trust proxy", 1);
const server = http.createServer(app);
// Bug #710: sockets were open to every origin. The game is served by this same server, so same-origin needs no CORS
// at all; ISP_APP_ORIGIN (comma-separated) names any other origin allowed in. Unset means none: fail closed.
const SOCKET_ORIGINS = String(process.env.ISP_APP_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
const io = new Server(server, {
  cors: {
    origin: SOCKET_ORIGINS.length ? SOCKET_ORIGINS : false
  }
});

export { IS_DEV, DEV_SURFACE, __dirname, io, APP_VERSION, app, server };

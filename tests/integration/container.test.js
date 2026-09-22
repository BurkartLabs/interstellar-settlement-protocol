import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { getApp } from "../helpers/app.js";

// AB#735: the container. The health probe, and guards on the Dockerfile and .dockerignore; the image itself is checked
// with docker build / run (the pull request shows the commands and their output).
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => fs.readFileSync(path.join(repo, f), "utf8");

describe("GET /healthz (AB#735)", () => {
  it("answers 200 with {ok:true} and nothing else, with no login", async () => {
    const { app } = await getApp();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.text).toBe('{"ok":true}');
  });

  it("names no framework, version, path or environment", async () => {
    const { app } = await getApp();
    const res = await request(app).get("/healthz");
    expect(res.headers).not.toHaveProperty("x-powered-by");
    expect(res.text).not.toMatch(/version|node|express|\/app|production|test|data/i);
  });
});

describe("the image (AB#735)", () => {
  const dockerfile = read("Dockerfile");
  const ignored = read(".dockerignore").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  it("installs production dependencies only, as locked, on Node 24", () => {
    expect(dockerfile).toMatch(/^FROM node:24/m);
    expect(dockerfile).toMatch(/npm ci --omit=dev/);
  });

  it("runs as the unprivileged node user, with the data directory on /data", () => {
    const lastUser = dockerfile.match(/^USER (\S+)/gm)?.at(-1);
    expect(lastUser).toBe("USER node");
    expect(dockerfile).toMatch(/ISP_DATA_DIR=\/data/);
    expect(dockerfile).not.toMatch(/JWT_SECRET=/);
  });

  it("keeps what the server writes, secrets and dependencies out of the build context (Bug #415)", () => {
    for (const entry of ["data/accounts-snapshot.json", "data/*accounts*.json", "data/state.json", "data/*.tmp", ".env", ".env.*", "node_modules", ".git"]) {
      expect(ignored, entry).toContain(entry);
    }
  });
});

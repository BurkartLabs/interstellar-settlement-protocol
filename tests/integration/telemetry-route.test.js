import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { telemetryDir } from "../../server/telemetry.js";

// ISP-256 (AB#952): POST /api/telemetry through the running server. Open without a login (an event names no account),
// valid events stored and invalid ones dropped, at most 20 a request and 8 KB a body, and no address kept.
let app;
beforeAll(async () => { ({ app } = await getApp()); });

const ev = (event, props) => ({ event, distinct_id: "a".repeat(32), session_id: "b".repeat(32), app_version: "0.4", platform: "web-desktop", props });
const stored = () => {
  const folder = telemetryDir();
  return fs.existsSync(folder) ? fs.readdirSync(folder).flatMap((f) => fs.readFileSync(path.join(folder, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
};

describe("POST /api/telemetry (AB#952)", () => {
  it("stores the valid events and drops the rest, with no login and no address", async () => {
    const before = stored().length;
    const res = await request(app).post("/api/telemetry").send({ events: [ev("app_open", { source: "direct" }), ev("rank_up", { level: "2" }), { event: "app_open" }] });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 1, dropped: 2 });
    const rows = stored().slice(before);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["app_version", "at", "distinct_id", "event", "platform", "props", "session_id"]);
    expect(JSON.stringify(rows)).not.toMatch(/127\.0\.0\.1|::ffff|::1/);
  });

  it("refuses a body that is not a list of events, more than 20 events, and a body over 8 KB", async () => {
    expect((await request(app).post("/api/telemetry").send({ events: "app_open" })).status).toBe(400);
    expect((await request(app).post("/api/telemetry").send({ events: [] })).status).toBe(400);
    expect((await request(app).post("/api/telemetry").send({ events: Array.from({ length: 21 }, () => ev("app_open", { source: "direct" })) })).status).toBe(400);
    const big = await request(app).post("/api/telemetry").set("Content-Type", "application/json").send(JSON.stringify({ events: [ev("app_open", { source: "direct" })], pad: "x".repeat(9000) }));
    expect(big.status).toBe(413);
  });

  it("takes the page's beacon, sent as a JSON blob", async () => {
    const res = await request(app).post("/api/telemetry").set("Content-Type", "application/json").send(JSON.stringify({ events: [ev("session_end", { duration_s: 12, actions: 1 })] }));
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(1);
  });
});

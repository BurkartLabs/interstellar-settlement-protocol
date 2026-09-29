import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// AB#959: with ISP_CSP_REPORT_FILE set, the policy gains report-uri and each violation the browser posts is one JSON
// line in that file (scripts/csp-audit.mjs counts them). Set before the server loads. Without it (security-headers
// test), there is neither.
const REPORT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "isp-csp-report-")), "violations.jsonl");
process.env.ISP_CSP_REPORT_FILE = REPORT_FILE;
const { getApp } = await import("../helpers/app.js");

let app;
beforeAll(async () => { ({ app } = await getApp()); });

const REPORT = {
  "csp-report": {
    "document-uri": "http://127.0.0.1:3000/?account=abc",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "inline",
    "source-file": "http://127.0.0.1:3000/scripts/app.js",
    "line-number": 12
  }
};

describe("CSP violation reports (AB#959)", () => {
  it("adds report-uri to the same policy", async () => {
    const csp = (await request(app).get("/")).headers["content-security-policy"];
    expect(csp).toMatch(/(^|;)\s*report-uri \/csp-report(;|$)/);
    expect(csp).toContain("script-src-attr 'none'");
  });

  it("appends a browser's report, sent as application/csp-report, as one line", async () => {
    const before = fs.existsSync(REPORT_FILE) ? fs.readFileSync(REPORT_FILE, "utf8") : "";
    const res = await request(app).post("/csp-report").set("Content-Type", "application/csp-report").send(JSON.stringify(REPORT));
    expect(res.status).toBe(204);
    const added = fs.readFileSync(REPORT_FILE, "utf8").slice(before.length).trim().split("\n");
    expect(added).toHaveLength(1);
    expect(JSON.parse(added[0])).toMatchObject({ directive: "script-src-elem", blocked: "inline", line: 12 });
  });

  it("ignores a body that is not a report, and still answers 204", async () => {
    const before = fs.existsSync(REPORT_FILE) ? fs.readFileSync(REPORT_FILE, "utf8") : "";
    for (const body of ["not json", JSON.stringify({ other: 1 }), JSON.stringify({ "csp-report": "x" })]) {
      const res = await request(app).post("/csp-report").set("Content-Type", "application/csp-report").send(body);
      expect(res.status).toBe(204);
    }
    const after = fs.existsSync(REPORT_FILE) ? fs.readFileSync(REPORT_FILE, "utf8") : "";
    expect(after).toBe(before);
  });
});

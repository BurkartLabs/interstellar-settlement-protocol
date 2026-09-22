import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #1123: a body the server cannot read is the client's mistake. It was answered 500 "Internal server error." and
// logged as a server fault. Each is now answered with its own 4xx and fixed text, before any route runs.
afterEach(() => vi.restoreAllMocks());

async function corporation() {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  const hire = () =>
    request(app).post(`/api/accounts/${account.id}/gameplay/hire`).set("Authorization", `Bearer ${accessToken}`);
  const snapshot = () => JSON.stringify(getAccountById(account.id).state);
  return { app, id: account.id, hire, snapshot };
}

const quiet = () => ({ warn: vi.spyOn(console, "warn").mockImplementation(() => {}), error: vi.spyOn(console, "error").mockImplementation(() => {}) });

describe("a request body the server cannot read (Bug #1123)", () => {
  it("a body that is not JSON gets 400 and changes nothing (the item's repro: hire with count=5)", async () => {
    const { hire, snapshot } = await corporation();
    const log = quiet();
    const before = snapshot();
    const res = await hire().set("Content-Type", "application/json").send("count=5");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "The request body is not valid JSON." });
    // Nothing of the parser's message, the body or a stack goes back.
    expect(res.text).not.toMatch(/count=5|Unexpected token|SyntaxError|at .*\.js/);
    expect(snapshot()).toBe(before);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("a body over the size limit gets 413 and changes nothing", async () => {
    const { hire, snapshot } = await corporation();
    quiet();
    const before = snapshot();
    const res = await hire().set("Content-Type", "application/json").send(JSON.stringify({ count: 1, pad: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "The request body is too large." });
    expect(snapshot()).toBe(before);
  });

  it("a charset other than UTF-8 gets 415, and an unknown content encoding gets 415", async () => {
    const { hire, snapshot } = await corporation();
    quiet();
    const before = snapshot();
    const charset = await hire().set("Content-Type", "application/json; charset=latin1").send('{"count":1}');
    expect(charset.status).toBe(415);
    expect(charset.body).toEqual({ error: "The request body must be UTF-8." });
    const encoding = await hire().set("Content-Type", "application/json").set("Content-Encoding", "compress").send('{"count":1}');
    expect(encoding.status).toBe(415);
    expect(encoding.body).toEqual({ error: "The request body's content encoding is not supported." });
    expect(snapshot()).toBe(before);
  });

  it("a body that says gzip but does not decompress gets 400 with the generic text and changes nothing", async () => {
    const { hire, snapshot } = await corporation();
    quiet();
    const before = snapshot();
    const res = await hire().set("Content-Type", "application/json").set("Content-Encoding", "gzip").send('{"count":1}');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "The request could not be read." });
    expect(res.text).not.toMatch(/header|zlib|at .*\.js/);
    expect(snapshot()).toBe(before);
  });

  it("a path that does not decode gets 400 with the generic text", async () => {
    const { app } = await getApp();
    quiet();
    const res = await request(app).get("/api/accounts/%E0%A4%A/state");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "The request could not be read." });
  });

  it("a real server fault is still 500 with the generic text, logged as an error", async () => {
    const { id, hire } = await corporation();
    const log = quiet();
    // A corporation with no finances makes the hire route throw inside the server.
    mutateAccountState(id, (s) => { s.corp.finances = null; });
    const res = await hire().send({ count: 1 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error." });
    expect(res.text).not.toMatch(/TypeError|finances|at .*\.js/);
    expect(log.error).toHaveBeenCalled();
  });
});

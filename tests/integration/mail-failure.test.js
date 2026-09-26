import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { accountsStore } from "../../server/game/store.js";
import { failNextSends } from "../../server/mailTestTransport.js";
import { registerAccount } from "../helpers/api.js";

// ISP-282 (AB#989): a transport failure leaves nothing half-created and logs no address.
afterEach(() => { failNextSends(0); vi.restoreAllMocks(); });
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("when the verification email cannot be sent (AB#989)", () => {
  it("registration answers 503, keeps no account, and the email and corporation name are free again", async () => {
    const { app } = await getApp();
    const logged = [];
    vi.spyOn(console, "error").mockImplementation((...args) => logged.push(args.join(" ")));
    const s = stamp();
    const body = { email: `fail-${s}@example.test`, password: "supersecret123", ceoName: "Test CEO", corpName: `Fail Corp ${s.slice(-5)}` };
    const before = Object.keys(accountsStore.accounts).length;
    failNextSends(1);
    const res = await request(app).post("/api/auth/register").send(body);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("mail-failed");
    expect(Object.keys(accountsStore.accounts).length).toBe(before);
    expect(Object.values(accountsStore.accounts).some((a) => a.email === body.email)).toBe(false);
    expect(logged.join("\n")).not.toContain(body.email);
    // Nothing is held: the same email and name register once mail works again.
    expect((await request(app).post("/api/auth/register").send(body)).status).toBe(201);
  });

  it("a reset request gives its one answer for every address, and logs no address", async () => {
    const { app } = await getApp();
    const { body } = await registerAccount(app);
    const logged = [];
    vi.spyOn(console, "error").mockImplementation((...args) => logged.push(args.join(" ")));
    failNextSends(1);
    const known = await request(app).post("/api/auth/forgot-password").send({ email: body.email });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: `nobody-${stamp()}@example.test` });
    // A 503 only when a send fails would say the address has an account; the answer is the same either way.
    expect([known.status, known.body]).toEqual([unknown.status, unknown.body]);
    expect(logged.join("\n")).not.toContain(body.email);
  });
});

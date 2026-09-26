// AB#781 (D-0.5-5, AB#697: "Once beta, anybody should be able to register"): registration takes no invitation, and
// REGISTRATION_OPEN is the one switch that closes it. Unset is open; "false" closes it with a 403 that creates nothing;
// a value the server cannot read closes it too, and says so in the log once.

import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { storedAccountByEmail } from "../helpers/api.js";
import { REGISTRATION_CLOSED_MESSAGE, registrationOpen } from "../../server/registration.js";

const saved = process.env.REGISTRATION_OPEN;
afterEach(() => {
  if (saved === undefined) delete process.env.REGISTRATION_OPEN;
  else process.env.REGISTRATION_OPEN = saved;
  vi.restoreAllMocks();
});

let seq = 0;
function applicant() {
  seq += 1;
  return { email: `open-${Date.now()}-${seq}@example.com`, password: "a-fine-password", ceoName: "Alex Rivera", corpName: `Open Corp ${Date.now()}-${seq}` };
}

describe("registration is open to anyone, with no invitation (AB#781)", () => {
  it("registers with an email, a password and two names, and nothing else", async () => {
    delete process.env.REGISTRATION_OPEN;
    const { app } = await getApp();
    const who = applicant();
    const res = await request(app).post("/api/auth/register").send(who);
    expect(res.status).toBe(201);
    expect((await storedAccountByEmail(who.email)).account?.id).toBeTruthy(); // AB#2288: read by email
  });

  it("an invitation field in the request is ignored, not required and not checked", async () => {
    delete process.env.REGISTRATION_OPEN;
    const { app } = await getApp();
    const res = await request(app).post("/api/auth/register").send({ ...applicant(), inviteCode: "anything" });
    expect(res.status).toBe(201);
  });
});

describe("REGISTRATION_OPEN=false closes registration (AB#781)", () => {
  it("answers 403 'Registration is closed for now.' and creates no account", async () => {
    const { app } = await getApp();
    const who = applicant();
    process.env.REGISTRATION_OPEN = "false";
    const closed = await request(app).post("/api/auth/register").send(who);
    expect(closed.status).toBe(403);
    expect(closed.body).toEqual({ error: REGISTRATION_CLOSED_MESSAGE, code: "registration-closed" });
    expect(REGISTRATION_CLOSED_MESSAGE).toBe("Registration is closed for now.");
    expect(closed.headers["set-cookie"]).toBeUndefined();

    // Nothing was created: that email cannot log in, and is still free once registration reopens.
    const login = await request(app).post("/api/auth/login").send({ email: who.email, password: who.password });
    expect(login.status).toBe(401);
    process.env.REGISTRATION_OPEN = "true";
    expect((await request(app).post("/api/auth/register").send(who)).status).toBe(201);
  });

  it("an unparseable value is closed, and logged once however many registrations it refuses", async () => {
    const { app } = await getApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.REGISTRATION_OPEN = "maybe-781";
    for (let i = 0; i < 3; i++) expect((await request(app).post("/api/auth/register").send(applicant())).status).toBe(403);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("REGISTRATION_OPEN"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("maybe-781");
  });
});

describe("reading the switch (AB#781)", () => {
  const read = (value) => registrationOpen(value === undefined ? {} : { REGISTRATION_OPEN: value }, () => {});

  it("unset is open: the beta's default", () => {
    expect(read(undefined)).toBe(true);
  });

  it("reads the usual spellings of yes and no, in any case and with spaces around them", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on", "open", " Open "]) expect(read(v), v).toBe(true);
    for (const v of ["false", "False", "0", "no", "off", "closed", " CLOSED "]) expect(read(v), v).toBe(false);
  });

  it("fails closed on anything else, the empty string included", () => {
    for (const v of ["", "  ", "ture", "2", "open please", "null"]) expect(read(v), JSON.stringify(v)).toBe(false);
  });
});

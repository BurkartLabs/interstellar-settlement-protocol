import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore, getState, mutateAccountState } from "../../server/game/store.js";
import { dataDir } from "../../server/game/catalog.js";
import { settleTransfer } from "../../server/settlement.js";
import { conversationIdFor, ERASED_MESSAGE } from "../../server/game/conversations.js";
import { ANONYMISED_CEO_NAME, ANONYMISED_CORPORATION_NAME, DATA_FILES, setErasureFaultForTests } from "../../server/accountData.js";
import { RESERVED_CORPORATION_NAMES } from "../../server/game/world.js";

// ISP-264 (AB#960; GDPR Articles 17 and 20): a player deletes the account and exports its data. The server's stores are
// files under its data directory (server/accountData.js DATA_FILES), which play the part of the item's account-keyed
// tables: every file the server writes there is classified, the export has one key per store that holds anything about
// an account, and after deletion no file under the data directory holds the email, the password hash or a token.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASSWORD = "supersecret123";

/** Every name the server joins onto its data directory (the scan of tests/unit/runtimeDataIgnored.test.js). */
function runtimeNames() {
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
  const names = new Set();
  for (const file of files(path.join(ROOT, "server"))) {
    const src = fs.readFileSync(file, "utf8");
    if (!/\bdataDir\b/.test(src)) continue;
    for (const m of src.matchAll(/path\.join\(\s*(dataDir|dir)\s*,\s*"([^"]+)"/g)) {
      if (m[1] === "dir" && !/\bdir\s*=\s*dataDir\b/.test(src)) continue;
      names.add(m[2]);
    }
    if (/\.tmp\b/.test(src) && /dataDir/.test(src)) names.add("x.json.tmp");
  }
  return [...names].sort();
}
/** Every file under the data directory, with its text. */
function dataFiles(dir = dataDir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? dataFiles(p) : [[path.relative(dataDir, p), fs.readFileSync(p, "utf8")]];
  });
}

async function player() {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  const id = reg.account.id;
  return { app, reg, id, api: authed(app, reg.accessToken), at: (p) => `/api/accounts/${id}${p}`, record: () => accountsStore.accounts[id], corp: () => accountsStore.accounts[id].state.corp };
}
/** A player with something in every kind of store: a forum thread, a conversation, a ledger line, a raid in the market. */
async function busyPlayer() {
  const me = await player();
  const other = await player();
  const thread = await me.api.post("/api/forums/threads").send({ category: getState().forums?.categories?.[0] || "general", title: "Selling titanium", body: "Best prices at Earth." });
  const sent = await me.api.post(me.at("/messages/send")).send({ toCorpId: other.corp().publicId, subject: "Deal", body: "My private offer: 40 a unit." });
  const reply = await other.api.post(other.at("/messages/send")).send({ toCorpId: me.corp().publicId, subject: "Re: Deal", body: "Their reply stays theirs." });
  mutateAccountState(me.id, (s) => { s.corp.finances.credits = 50_000; }, { sanitize: false, settleMining: false });
  const fee = settleTransfer({ fromAccountId: me.id, toAccountId: "sink:fee", credits: 100, reason: "fee", idempotencyKey: `fee:${me.id}` });
  const corp = me.corp();
  const raid = { id: `raid-test-${me.id}`, attackerCorpId: other.corp().publicId, attackerName: other.corp().corporationName, targetCorpId: corp.publicId, targetName: corp.corporationName, state: "resolved" };
  const { mutateState } = await import("../../server/game/store.js");
  mutateState((w) => { w.market.raids = [...(w.market.raids || []), raid]; });
  return { me, other, thread, sent, reply, fee, raid, names: { email: me.reg.body.email, corp: corp.corporationName, ceo: corp.ceo, hash: me.record().passwordHash, tokens: me.record().refreshTokens.map((t) => t.token) } };
}

afterEach(() => setErasureFaultForTests(null));

describe("ISP-264 the stores (AB#960)", () => {
  it("every file the server writes into its data directory is classified, so the export and the erasure miss none", () => {
    expect(runtimeNames()).toEqual(Object.keys(DATA_FILES).sort());
  });
});

describe("ISP-264 export (AB#960)", () => {
  it("gives the owner every account-keyed record, one key per store, with credentials named but never sent", async () => {
    const { me, other, raid } = await busyPlayer();
    const res = await me.api.get(me.at("/export"));
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.headers["cache-control"]).toMatch(/private/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="isp-account-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = JSON.parse(res.text);
    // one key per store that can hold anything about an account (the schema's account-keyed and shared stores)
    expect(Object.keys(body.data).sort()).toEqual(Object.entries(DATA_FILES).filter(([, kind]) => kind !== "none").map(([k]) => k).sort());
    const record = body.data["accounts-snapshot.json"].account;
    expect(record).toMatchObject({ id: me.id, email: me.reg.body.email });
    expect(record.state.corp.corporationName).toBe(me.corp().corporationName);
    for (const secret of ["passwordHash", "refreshTokens"]) expect(record[secret]).toBeUndefined();
    expect(body.data["accounts-snapshot.json"].withheld.map((w) => w.field)).toEqual(expect.arrayContaining(["passwordHash", "refreshTokens"]));
    expect(res.text).not.toContain(me.record().passwordHash);
    // the shared stores: its forum thread and the raid on it; its mail both ways; its ledger line
    expect(body.data["state.json"].map((r) => r.record.id)).toEqual(expect.arrayContaining([raid.id]));
    expect(body.data["state.json"].some((r) => r.record.title === "Selling titanium")).toBe(true);
    const conversation = body.data.messages.find((c) => c.conversationId === conversationIdFor(me.id, other.id));
    expect(conversation.messages.map((m) => m.body)).toEqual(expect.arrayContaining(["My private offer: 40 a unit.", "Their reply stays theirs."]));
    expect(body.data.inbox.length).toBeGreaterThan(0);
    expect(body.data["settlement-ledger.jsonl"]).toEqual([expect.objectContaining({ from: me.id, to: "sink:fee", credits: 100 })]);
  });

  it("is the owner's alone", async () => {
    const { me, other } = await busyPlayer();
    expect((await other.api.get(me.at("/export"))).status).toBe(403);
    expect((await request(me.app).get(me.at("/export"))).status).toBe(401);
  });
});

describe("ISP-264 deletion (AB#960)", () => {
  it("refuses without the password or the word DELETE, changing nothing", async () => {
    const { me } = await busyPlayer();
    const before = JSON.stringify(me.record());
    for (const body of [{ password: PASSWORD }, { password: PASSWORD, confirm: "delete" }, { password: "wrong-password-1", confirm: "DELETE" }, {}]) {
      const r = await me.api.post(me.at("/delete-account")).send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toMatch(/Nothing was deleted|DELETE|password/);
    }
    expect(JSON.stringify(me.record())).toBe(before);
    const other = await player();
    expect((await other.api.post(me.at("/delete-account")).send({ password: PASSWORD, confirm: "DELETE" })).status).toBe(403);
  });

  it("erases the email, password hash, tokens, notifications and mail from every file, and anonymises the corporation in shared history", async () => {
    const { me, other, raid, thread, names } = await busyPlayer();
    const res = await me.api.post(me.at("/delete-account")).send({ password: PASSWORD, confirm: "DELETE" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["set-cookie"]?.join(";")).toMatch(/isp_refresh=;/);

    // no store holds the email, the hash, a token or the CEO's name (a test reads every file under the data directory)
    for (const [file, text] of dataFiles()) {
      for (const [what, secret] of [["email", names.email], ["password hash", names.hash], ["CEO name", names.ceo === "Test CEO" ? null : names.ceo], ...names.tokens.map((t) => ["refresh token", t])]) {
        if (secret) expect(text.includes(secret), `${file} holds the ${what}`).toBe(false);
      }
    }
    // the tombstone: nothing that identifies a person, and nothing that admits one
    const tomb = me.record();
    for (const k of ["email", "passwordHash", "refreshTokens", "notifications", "messages", "emailVerification", "passwordReset"]) expect(tomb[k], k).toBeUndefined();
    expect(tomb.deletedAt).toBeGreaterThan(0);
    expect(tomb.state.corp).toMatchObject({ corporationName: ANONYMISED_CORPORATION_NAME, ceo: ANONYMISED_CEO_NAME });
    // shared history keeps its records, under the label
    expect(getState().market.raids.find((r) => r.id === raid.id)).toMatchObject({ targetCorpId: tomb.state.corp.publicId, targetName: ANONYMISED_CORPORATION_NAME });
    expect(getState().forums.threads.find((t) => t.id === thread.body.thread?.id || t.title === "Selling titanium").author).toBe(ANONYMISED_CORPORATION_NAME);
    // the other side's conversation stays whole: its own reply as written, the deleted side's words gone
    const theirs = await other.api.get(`/api/accounts/${other.id}/conversations/${conversationIdFor(me.id, other.id)}/messages`);
    const bodies = (theirs.body.messages || []).map((m) => [m.fromName, m.body]);
    expect(bodies).toEqual(expect.arrayContaining([[ANONYMISED_CORPORATION_NAME, ERASED_MESSAGE], [other.corp().corporationName, "Their reply stays theirs."]]));
    expect(JSON.stringify(theirs.body)).not.toContain("My private offer");
    // nobody can sign in as it, with a token it held, or by its old address
    expect((await me.api.get(me.at(""))).status).toBe(401);
    expect((await request(me.app).post("/api/auth/login").send({ email: names.email, password: PASSWORD })).status).toBe(401);
    expect((await request(me.app).post("/api/auth/refresh").set("Cookie", `isp_refresh=${me.reg.refreshToken}`)).status).toBe(401);
    // and nobody can register as the label
    expect(RESERVED_CORPORATION_NAMES).toContain(ANONYMISED_CORPORATION_NAME);
  });

  it("fails closed: a failure part-way puts every store back, and the account still works", async () => {
    const { resetDominanceCache } = await import("../../server/dominanceService.js");
    for (const step of ["world", "files", "chat", "mail", "account"]) {
      resetDominanceCache(); // a store that holds nothing yet (before its first tick) is skipped, and does not stop the rollback
      const { me, other, raid, names } = await busyPlayer();
      const before = { record: JSON.stringify(me.record()), otherRecord: JSON.stringify(other.record()), raids: JSON.stringify(getState().market.raids) };
      setErasureFaultForTests(step);
      const res = await me.api.post(me.at("/delete-account")).send({ password: PASSWORD, confirm: "DELETE" });
      expect(res.status, step).toBe(500);
      expect(res.body.error).toMatch(/nothing was changed/);
      expect(JSON.stringify(me.record()), step).toBe(before.record);
      expect(JSON.stringify(other.record()), step).toBe(before.otherRecord);
      expect(JSON.stringify(getState().market.raids), step).toBe(before.raids);
      expect(getState().market.raids.find((r) => r.id === raid.id).targetName).toBe(names.corp);
      const theirs = await other.api.get(`/api/accounts/${other.id}/conversations/${conversationIdFor(me.id, other.id)}/messages`);
      expect(JSON.stringify(theirs.body), step).toContain("My private offer");
      expect((await me.api.get(me.at(""))).status, step).toBe(200);
      setErasureFaultForTests(null);
    }
  });
});

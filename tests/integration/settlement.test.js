import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { getAccountById, mutateAccountState } from "../../server/gameState.js";
import { settleTransfer, REASONS, loadLedger, ledgerEntries, ledgerPath, settlementTotals } from "../../server/settlement.js";
import { accountsSnapshotPath } from "../../server/game/catalog.js";

// ISP-146 (AB#840): one audited path for credits moving between two parties. Five fixture corporations, real accounts
// through the real store; every hostile request is refused with nothing moved, a key moves credits once, credits are
// conserved over 1,000 random transfers, and the ledger and the balances survive a restart.
const START = 100_000;
let ids = [];
const credits = (id) => getAccountById(id).state.corp.finances.credits;
const corpTotal = () => ids.reduce((sum, id) => sum + credits(id), 0);
const settled = () => { const t = settlementTotals(); return Object.values(t.escrow).reduce((a, b) => a + b, 0) + Object.values(t.sinks).reduce((a, b) => a + b, 0); };
let keySeq = 0;
const key = () => `test:${Date.now().toString(36)}:${++keySeq}`;

beforeAll(async () => {
  const { app } = await getApp();
  for (let i = 0; i < 5; i++) {
    const { account } = await registerAccount(app);
    mutateAccountState(account.id, (s) => { s.corp.finances.credits = START; }, { sanitize: false, settleMining: false });
    ids.push(account.id);
  }
});

describe("ISP-146 settleTransfer refuses what it cannot vouch for, and moves nothing", () => {
  it("rejects a bad amount, reason, key or party, a self-payment and an overdraft, leaving both balances as they were", () => {
    const [a, b] = ids;
    const before = [credits(a), credits(b)];
    const bad = [
      { credits: -5 }, { credits: 0 }, { credits: 1.5 }, { credits: NaN }, { credits: "100" }, { credits: Infinity },
      { credits: Number.MAX_SAFE_INTEGER + 2 }, { credits: undefined },
      { reason: "gift" }, { reason: undefined }, { idempotencyKey: "" }, { idempotencyKey: "has space" }, { idempotencyKey: 7 },
      { toAccountId: "no-such-account" }, { fromAccountId: "no-such-account" }, { toAccountId: a },
      { credits: START + 1 },
      { toAccountId: "sink:fee" }, { reason: "fee", toAccountId: b }, { reason: "fee", toAccountId: "sink:tax" },
      { reason: "escrow-release" }, { reason: "escrow-hold" }
    ];
    for (const over of bad) {
      const r = settleTransfer({ fromAccountId: a, toAccountId: b, credits: 10, reason: "dividend", idempotencyKey: key(), ...over });
      expect(r.ok, JSON.stringify(over)).toBe(false);
      expect(typeof r.error).toBe("string");
      expect([credits(a), credits(b)], JSON.stringify(over)).toEqual(before);
    }
    expect(settleTransfer().ok).toBe(false);
  });

  it("the reasons are exactly the instruments, and the list cannot be changed", () => {
    expect([...REASONS].sort()).toEqual(["bond-subscription", "coupon", "dividend", "escrow-hold", "escrow-release", "fee", "loan-disbursal", "loan-interest", "loan-repayment", "share-purchase"]); // AB#844 adds loan-interest
    expect(Object.isFrozen(REASONS)).toBe(true);
  });
});

describe("ISP-146 a transfer moves once, is booked on both statements, and is written down", () => {
  it("replaying a key moves credits once and writes one entry; the same key for different terms is refused", () => {
    const [a, b] = ids;
    const [ca, cb] = [credits(a), credits(b)];
    const k = key();
    const first = settleTransfer({ fromAccountId: a, toAccountId: b, credits: 250, reason: "dividend", idempotencyKey: k });
    const again = settleTransfer({ fromAccountId: a, toAccountId: b, credits: 250, reason: "dividend", idempotencyKey: k });
    expect(first.ok).toBe(true);
    expect(again).toEqual({ ok: true, entry: first.entry, replayed: true });
    expect([credits(a), credits(b)]).toEqual([ca - 250, cb + 250]);
    expect(ledgerEntries().filter((e) => e.key === k)).toHaveLength(1);
    expect(settleTransfer({ fromAccountId: a, toAccountId: b, credits: 251, reason: "dividend", idempotencyKey: k }).ok).toBe(false);
    expect(first.entry).toMatchObject({ from: a, to: b, credits: 250, reason: "dividend", key: k });
  });

  it("each side books it under the reason, so each statement still adds up", () => {
    const [, , c, d] = ids;
    const fin = (id) => getAccountById(id).state.corp.finances;
    const booked = (id) => ({ paid: fin(id).dayBook?.expenses?.["coupon-paid"] ?? 0, received: fin(id).dayBook?.income?.["coupon-received"] ?? 0, credits: fin(id).credits });
    const [pc, pd] = [booked(c), booked(d)];
    expect(settleTransfer({ fromAccountId: c, toAccountId: d, credits: 1_000, reason: "coupon", idempotencyKey: key() }).ok).toBe(true);
    // the day's book moves by exactly what the balance moved, under the reason's name on each side (AB#712)
    expect(booked(c)).toEqual({ paid: pc.paid + 1_000, received: pc.received, credits: pc.credits - 1_000 });
    expect(booked(d)).toEqual({ paid: pd.paid, received: pd.received + 1_000, credits: pd.credits + 1_000 });
    expect(fin(c).expensesByCategory["coupon-paid"]).toBeGreaterThanOrEqual(1_000);
    expect(fin(d).incomeBySource["coupon-received"]).toBeGreaterThanOrEqual(1_000);
  });

  it("conserves credits over 1,000 random transfers among 5 corporations; fees land in the fee sink's total", () => {
    const before = corpTotal() + settled();
    const feeBefore = settlementTotals().sinks.fee ?? 0;
    let seed = 42;
    const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const corpReasons = REASONS.filter((r) => !["fee", "escrow-hold", "escrow-release"].includes(r));
    let fees = 0, moved = 0;
    for (let i = 0; i < 1_000; i++) {
      const a = ids[rand(5)], b = ids[(ids.indexOf(a) + 1 + rand(4)) % 5];
      const amount = 1 + rand(900);
      const kind = rand(10);
      let r;
      if (kind === 0) { r = settleTransfer({ fromAccountId: a, toAccountId: "sink:fee", credits: amount, reason: "fee", idempotencyKey: key() }); if (r.ok) fees += amount; }
      else if (kind === 1) r = settleTransfer({ fromAccountId: a, toAccountId: `escrow:t${i % 7}`, credits: amount, reason: "escrow-hold", idempotencyKey: key() });
      else if (kind === 2 && (settlementTotals().escrow[`escrow:t${i % 7}`] ?? 0) > 0) {
        const held = settlementTotals().escrow[`escrow:t${i % 7}`];
        r = settleTransfer({ fromAccountId: `escrow:t${i % 7}`, toAccountId: b, credits: Math.min(amount, held), reason: "escrow-release", idempotencyKey: key() });
      } else r = settleTransfer({ fromAccountId: a, toAccountId: b, credits: amount, reason: corpReasons[rand(corpReasons.length)], idempotencyKey: key() });
      if (r.ok) moved++;
      expect(corpTotal() + settled()).toBe(before);
    }
    expect(moved).toBeGreaterThan(800); // the rest were overdrafts, refused
    expect((settlementTotals().sinks.fee ?? 0) - feeBefore).toBe(fees);
    expect(fees).toBeGreaterThan(0);
  }, 120_000); // Bug #2567: 1,000 transfers are 1,000 synchronous snapshot saves, which is the behaviour under test

  it("the ledger and the balances survive a restart", () => {
    const [a, b] = ids;
    const k = key();
    expect(settleTransfer({ fromAccountId: a, toAccountId: b, credits: 77, reason: "share-purchase", idempotencyKey: k }).ok).toBe(true);
    const count = ledgerEntries().length;
    // What a restart reads: the ledger file and the accounts snapshot, both already on disk.
    expect(loadLedger()).toBe(count);
    expect(ledgerEntries().find((e) => e.key === k)).toMatchObject({ from: a, to: b, credits: 77, reason: "share-purchase" });
    const lines = fs.readFileSync(ledgerPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(count);
    const snapshot = JSON.parse(fs.readFileSync(accountsSnapshotPath, "utf8"));
    for (const id of [a, b]) expect(snapshot.accounts[id].state.corp.finances.credits).toBe(credits(id));
    // and after the restart the key still moves nothing
    const [ca, cb] = [credits(a), credits(b)];
    expect(settleTransfer({ fromAccountId: a, toAccountId: b, credits: 77, reason: "share-purchase", idempotencyKey: k }).replayed).toBe(true);
    expect([credits(a), credits(b)]).toEqual([ca, cb]);
    expect(path.dirname(ledgerPath())).toBe(path.dirname(accountsSnapshotPath));
  });
});

describe("ISP-146 no HTTP route reaches settleTransfer directly", () => {
  it("server/index.js and every file in server/routes/ leave server/settlement.js to the instrument modules", () => {
    const serverDir = path.resolve(import.meta.dirname, "../../server");
    const files = [path.join(serverDir, "index.js"), ...fs.readdirSync(path.join(serverDir, "routes")).filter((f) => f.endsWith(".js")).map((f) => path.join(serverDir, "routes", f))];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(fs.readFileSync(f, "utf8"), path.basename(f)).not.toMatch(/settlement\.js["']/);
  });
});

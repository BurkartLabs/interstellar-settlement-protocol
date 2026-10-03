import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getState, mutateAccountState, getAccountById, peekCorp } from "../../server/gameState.js";
import { ECONOMY } from "../../server/economy.js";
import { utcDayStart, DAY_MS } from "../../server/finances.js";
import { deskState, openPacket } from "../../server/game/deskDraws.js";

// AB#4689 slice 5: the Desk's routes (docs/design/desk-work.md section 3, rules 1 to 4, 6 and 7).

const D = ECONOMY.desk;

/** A corporation with an office and no credits, as the spec's first acceptance line has it. */
async function deskCorp({ office = true } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (state) => {
    state.corp.finances.credits = 0;
    state.corp.finances.incomeBySource = {};
    state.corp.offices = office ? [{ stationId: "earth-station-prime", rentedUntil: Date.now() + 7 * DAY_MS }] : [];
  });
  const api = authed(app, accessToken);
  const base = `/api/accounts/${account.id}/gameplay/desk`;
  return {
    id: account.id,
    get: () => api.get(base),
    answer: (body) => api.post(`${base}/answer`).send(body),
    decline: (body) => api.post(`${base}/decline`).send(body),
    corp: () => getAccountById(account.id).state.corp
  };
}

/** The key behind an open draw, drawn the way the route draws it: the test's view of the server's secret. */
function keyOf(id, draw) {
  const corp = peekCorp(id);
  const entry = deskState(corp, id).open.find((e) => e.draw === draw);
  return openPacket(id, entry, { corp, belts: getState().belts }).key;
}

/** The right answer to a tier-1 packet of any kind. */
function rightAnswer(key) {
  if (key.kind === "survey") return { pick: key.truth[0].resource };
  if (key.kind === "audit") return key.broken.length ? { clauses: key.broken.map((b) => b.clause) } : { compliant: true };
  return { transferFee: key.transferFee, transitMinutes: key.transitMinutes };
}
/** A wrong answer to a tier-1 packet of any kind. */
function wrongAnswer(key) {
  if (key.kind === "survey") return { pick: "Not A Resource" };
  if (key.kind === "audit") return key.broken.length ? { compliant: true } : { clauses: ["lease-price"] };
  return { transferFee: key.transferFee * 3 + 100, transitMinutes: key.transitMinutes };
}
async function answerFirst(desk, { right = true, extra = {} } = {}) {
  const { body } = await desk.get();
  const { draw, fingerprint } = body.packets[0];
  const key = keyOf(desk.id, draw);
  return desk.answer({ draw, fingerprint, answer: right ? rightAnswer(key) : wrongAnswer(key), ...extra });
}

describe("GET /gameplay/desk", () => {
  it("shows a corporation with an office and no credits three packets, its standing and today's paid count, and sends no key", async () => {
    const desk = await deskCorp();
    const res = await desk.get();
    expect(res.status).toBe(200);
    expect(res.body.packets).toHaveLength(D.openPackets);
    for (const p of res.body.packets) {
      expect(["survey", "audit", "dispatch"]).toContain(p.packet.kind);
      expect(p.packet.tier).toBe(1);
      expect(JSON.stringify(p)).not.toMatch(/"(truth|broken|rules|transferFee|transitMinutes|minCost|key)"/);
    }
    expect(res.body.standing).toEqual({ points: 0, level: 0, title: "Unknown" });
    expect(res.body.paidToday).toBe(0);
    expect(JSON.stringify(desk.corp())).not.toMatch(/"(truth|broken|minCost)"/);
  });

  it("refuses a corporation with no office, with its code", async () => {
    const desk = await deskCorp({ office: false });
    const res = await desk.get();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("no-office");
    const answer = await desk.answer({ draw: 1, fingerprint: "abc", answer: { pick: "Silicates" } });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe("no-office");
  });
});

describe("POST /gameplay/desk/answer", () => {
  it("pays a correct answer its tier's fee under `desk`, adds its points, and draws the next packet", async () => {
    const desk = await deskCorp();
    const before = (await desk.get()).body.packets.map((p) => p.draw);
    const res = await answerFirst(desk);
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ correct: true, paid: D.payByTier[0], points: D.pointsByTier[0] });
    expect(res.body.result.explanation.length).toBeGreaterThan(20);
    const corp = desk.corp();
    expect(corp.finances.credits).toBe(D.payByTier[0]);
    expect(corp.finances.incomeBySource.desk).toBe(D.payByTier[0]);
    expect(corp.agentReputation["elara-voss"].points).toBe(D.pointsByTier[0]);
    const after = (await desk.get()).body.packets.map((p) => p.draw);
    expect(after).toHaveLength(D.openPackets);
    expect(after).not.toContain(before[0]);
    expect(after).toEqual([D.openPackets + 1, before[1], before[2]]);
  });

  it("pays nothing and costs nothing for a wrong answer, spends the packet and quotes the rule", async () => {
    const desk = await deskCorp();
    const first = (await desk.get()).body.packets[0].draw;
    const res = await answerFirst(desk, { right: false });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ correct: false, paid: 0, points: 0 });
    expect(res.body.result.explanation.length).toBeGreaterThan(20);
    const corp = desk.corp();
    expect(corp.finances.credits).toBe(0);
    expect(corp.agentReputation?.["elara-voss"]?.points || 0).toBe(0);
    const open = (await desk.get()).body.packets.map((p) => p.draw);
    expect(open).toHaveLength(D.openPackets);
    expect(open).not.toContain(first);
  });

  it("pays overCapPayPct past paidAssignmentsPerDay in a UTC day, at full points, and full pay again the next day", async () => {
    const desk = await deskCorp();
    mutateAccountState(desk.id, (state) => { state.corp.desk = { ...deskState(state.corp, desk.id), paidDay: utcDayStart(Date.now()), paidToday: D.paidAssignmentsPerDay }; });
    const over = await answerFirst(desk);
    expect(over.body.result).toMatchObject({ correct: true, paid: Math.round((D.payByTier[0] * D.overCapPayPct) / 100), points: D.pointsByTier[0] });
    expect(desk.corp().desk.paidToday).toBe(D.paidAssignmentsPerDay + 1);
    // Midnight UTC: a count kept from yesterday is today's 0.
    mutateAccountState(desk.id, (state) => { state.corp.desk.paidDay = utcDayStart(Date.now()) - DAY_MS; });
    expect((await desk.get()).body.paidToday).toBe(0);
    const next = await answerFirst(desk);
    expect(next.body.result.paid).toBe(D.payByTier[0]);
    expect(desk.corp().desk.paidToday).toBe(1);
  });

  it("grades against the stored key whatever the request claims (T-019)", async () => {
    const desk = await deskCorp();
    const { body } = await desk.get();
    const { draw, fingerprint } = body.packets[0];
    const key = keyOf(desk.id, draw);
    const forged = { kind: key.kind, tier: 1, truth: [{ resource: "Not A Resource" }], broken: [], transferFee: 1, transitMinutes: 1 };
    const res = await desk.answer({ draw, fingerprint, answer: wrongAnswer(key), correct: true, key: forged, truth: forged, paid: 9999, grade: "correct" });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ correct: false, paid: 0 });
    expect(desk.corp().finances.credits).toBe(0);
  });

  it("pays nothing for a spent or unknown packet, or one whose records changed", async () => {
    const desk = await deskCorp();
    const { body } = await desk.get();
    const { draw, fingerprint } = body.packets[0];
    const answer = rightAnswer(keyOf(desk.id, draw));
    expect((await desk.answer({ draw, fingerprint, answer })).status).toBe(200);
    const paid = desk.corp().finances.credits;
    const again = await desk.answer({ draw, fingerprint, answer });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("not-open");
    const unknown = await desk.answer({ draw: 999_999, fingerprint, answer });
    expect(unknown.body.code).toBe("not-open");
    const other = (await desk.get()).body.packets[1];
    const changed = await desk.answer({ draw: other.draw, fingerprint: "0".repeat(24), answer: rightAnswer(keyOf(desk.id, other.draw)) });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("changed");
    expect(desk.corp().finances.credits).toBe(paid);
  });

  it("refuses an answer that is not an object, before anything is spent", async () => {
    const desk = await deskCorp();
    const { draw, fingerprint } = (await desk.get()).body.packets[0];
    for (const answer of [undefined, "Silicates", ["Silicates"], { pick: "x".repeat(5000) }]) {
      const res = await desk.answer({ draw, fingerprint, answer });
      expect(res.status, JSON.stringify(answer)?.slice(0, 40)).toBe(400);
    }
    expect((await desk.get()).body.packets[0].draw).toBe(draw);
  });

  it("never counts as a contract: ten packets leave completedMissions and missionsCompletedTotal alone and count as desk work", async () => {
    const desk = await deskCorp();
    const before = desk.corp();
    const missions = (before.completedMissions || []).length;
    const total = before.stats?.missionsCompletedTotal || 0;
    for (let i = 0; i < 10; i += 1) expect((await answerFirst(desk)).body.result.correct).toBe(true);
    const corp = desk.corp();
    expect((corp.completedMissions || []).length).toBe(missions);
    expect(corp.stats?.missionsCompletedTotal || 0).toBe(total);
    expect(corp.stats.deskCompleted).toBe(10);
    const byKind = ["survey", "audit", "dispatch"].reduce((s, k) => s + (corp.stats[`deskCompleted:${k}`] || 0), 0);
    expect(byKind).toBe(10);
  });
});

describe("POST /gameplay/desk/decline", () => {
  it("replaces the packet at once, for nothing, and leaves standing alone", async () => {
    const desk = await deskCorp();
    const { packets } = (await desk.get()).body;
    const res = await desk.decline({ draw: packets[1].draw });
    expect(res.status).toBe(200);
    const open = (await desk.get()).body.packets.map((p) => p.draw);
    expect(open).toEqual([packets[0].draw, D.openPackets + 1, packets[2].draw]);
    const corp = desk.corp();
    expect(corp.finances.credits).toBe(0);
    expect(corp.agentReputation?.["elara-voss"]?.points || 0).toBe(0);
    expect((await desk.decline({ draw: packets[1].draw })).body.code).toBe("not-open");
  });
});

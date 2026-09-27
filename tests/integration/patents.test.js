import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, mutateAccountState, applyRefineryOperations } from "../../server/gameState.js";
import { processRndCompletions } from "../../server/ticks.js";
import { firstCompleter, resetPatentsForTests } from "../../server/patents.js";
import { WARFARE_CATALOG } from "../../server/warfare.js";

// ISP-235 (AB#930): filing patents at Corporate Registry & Charters (docs/design/WARFARE.md, Lawfare). Only the first
// corporation to complete a patentable subject may file, within the window; once per subject, never renewed; the rate
// inside its kind's bound; the fee paid or nothing written; the list public. Completion is read from the server's own
// records, and filing is refused when the order cannot be established.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = WARFARE_CATALOG.patents;
beforeEach(() => resetPatentsForTests());

async function corp({ research = {}, chains = {}, credits = 100_000, unlocked = [] } = {}) {
  const { app } = await getApp();
  const { account, accessToken } = await registerAccount(app);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = credits;
    s.corp.researchCompletedAt = { ...research };
    s.corp.chainFirstRunAt = { ...chains };
    s.corp.unlockedTech = [...new Set([...(s.corp.unlockedTech || []), ...Object.keys(research), ...unlocked])];
  }, { sanitize: false, settleMining: false });
  const api = authed(app, accessToken);
  return {
    app, id: account.id, api,
    corp: () => getAccountById(account.id).state.corp,
    file: (body) => api.post(`/api/accounts/${account.id}/patents`).send(body)
  };
}

describe("ISP-235 filing a patent", () => {
  it("the first completer files within the window: the fee is paid, and the list shows holder, subject, rate and term", async () => {
    const now = Date.now();
    const helios = await corp({ research: { "tt-actinide-handling": now - 2 * HOUR } });
    await corp({ research: { "tt-actinide-handling": now - HOUR } }); // second
    const before = helios.corp().finances.credits;
    const res = await helios.file({ kind: "research", subjectId: "tt-actinide-handling", ratePct: 20 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(helios.corp().finances.credits).toBe(before - T.filingFee);
    const list = await request(helios.app).get("/api/patents");
    expect(list.status).toBe(200);
    const p = list.body.patents.find((x) => x.subjectId === "tt-actinide-handling");
    expect(p).toMatchObject({ kind: "research", subjectName: "Actinide Handling", holder: helios.corp().corporationName, ratePct: 20, active: true });
    expect(p.endsAt - p.filedAt).toBe(T.termDays * DAY);
    expect(JSON.stringify(list.body)).not.toContain(helios.id); // no account id
    expect(JSON.stringify(list.body)).not.toContain(helios.corp().publicId);
  });

  it("a second completer, a late filing, a subject not completed and a subject not patentable are refused, and nothing is charged", async () => {
    const now = Date.now();
    await corp({ research: { "tt-deep-core-extraction": now - 3 * HOUR } });
    const second = await corp({ research: { "tt-deep-core-extraction": now - HOUR, "tt-exotic-containment": now - (T.filingWindowHours + 1) * HOUR } });
    const credits = second.corp().finances.credits;
    const cases = [
      [{ kind: "research", subjectId: "tt-deep-core-extraction", ratePct: 10 }, 403, "not-first"],
      [{ kind: "research", subjectId: "tt-exotic-containment", ratePct: 10 }, 409, "window-closed"],
      [{ kind: "research", subjectId: "tt-antimatter-confinement", ratePct: 10 }, 403, "not-completed"],
      [{ kind: "research", subjectId: "tt-basic-extraction", ratePct: 10 }, 400, "not-patentable"], // tier 1
      [{ kind: "chain", subjectId: "silicates-chain", ratePct: 1 }, 400, "not-patentable"], // stage 1
      [{ kind: "research", subjectId: "tt-no-such-node", ratePct: 1 }, 400, "not-patentable"]
    ];
    for (const [body, status, code] of cases) {
      const res = await second.file(body);
      expect(res.status, `${body.subjectId}: ${JSON.stringify(res.body)}`).toBe(status);
      expect(res.body.code, body.subjectId).toBe(code);
    }
    expect(second.corp().finances.credits).toBe(credits);
    expect((await request(second.app).get("/api/patents")).body.patents).toEqual([]);
  });

  it("a rate outside its kind's bound, or not a whole number, is refused", async () => {
    const now = Date.now();
    const c = await corp({ research: { "tt-high-energy-synthesis": now - HOUR }, chains: { "catalyst-bed-chain": now - HOUR } });
    expect((await c.file({ kind: "research", subjectId: "tt-high-energy-synthesis", ratePct: T.royaltyMaxPct + 1 })).status).toBe(400);
    expect((await c.file({ kind: "research", subjectId: "tt-high-energy-synthesis", ratePct: "abc" })).status).toBe(400);
    expect((await c.file({ kind: "research", subjectId: "tt-high-energy-synthesis", ratePct: 2.5 })).status).toBe(400);
    const chain = await c.file({ kind: "chain", subjectId: "catalyst-bed-chain", ratePct: T.chainRoyaltyMaxPct + 1 });
    expect(chain.status).toBe(400);
    expect(chain.body.code).toBe("rate-out-of-bounds");
    expect((await c.file({ kind: "chain", subjectId: "catalyst-bed-chain", ratePct: T.chainRoyaltyMaxPct })).status).toBe(201);
  });

  it("fails closed when the order cannot be established: a holder with no record, or two at the same moment", async () => {
    const now = Date.now();
    const first = await corp({ research: { "tt-deep-atmosphere-extraction": now - HOUR } });
    await corp({ unlocked: ["tt-deep-atmosphere-extraction"] }); // holds it, no completion record (granted, or before records)
    const res = await first.file({ kind: "research", subjectId: "tt-deep-atmosphere-extraction", ratePct: 5 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("order-unknown");
    const at = now - 2 * HOUR;
    const a = await corp({ chains: { "field-emitter-chain": at } });
    await corp({ chains: { "field-emitter-chain": at } });
    expect(firstCompleter("chain", "field-emitter-chain")).toMatchObject({ unknown: expect.stringContaining("same moment") });
    expect((await a.file({ kind: "chain", subjectId: "field-emitter-chain", ratePct: 1 })).body.code).toBe("order-unknown");
  });

  it("two filings at once: exactly one succeeds, and the fee is charged once", async () => {
    const c = await corp({ research: { "tt-antimatter-confinement": Date.now() - HOUR } });
    const credits = c.corp().finances.credits;
    const body = { kind: "research", subjectId: "tt-antimatter-confinement", ratePct: 25 };
    const results = await Promise.all([c.file(body), c.file(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(c.corp().finances.credits).toBe(credits - T.filingFee);
  });

  it("a patent is filed once: after its term, nobody refiles it, the holder included", async () => {
    const c = await corp({ chains: { "antimatter-chain": Date.now() - HOUR } });
    expect((await c.file({ kind: "chain", subjectId: "antimatter-chain", ratePct: 3 })).status).toBe(201);
    const later = Date.now() + (T.termDays + 1) * DAY;
    const { filePatent } = await import("../../server/patents.js");
    expect(filePatent(c.id, { kind: "chain", subjectId: "antimatter-chain", ratePct: 3 }, later).refused.code).toBe("already-patented");
    const list = (await request(c.app).get("/api/patents")).body.patents;
    expect(list.filter((p) => p.subjectId === "antimatter-chain")).toHaveLength(1);
  });

  it("without the fee, nothing is filed", async () => {
    const c = await corp({ chains: { "superconductor-chain": Date.now() - HOUR }, credits: T.filingFee - 1 });
    const res = await c.file({ kind: "chain", subjectId: "superconductor-chain", ratePct: 2 });
    expect(res.status).toBe(402);
    expect(c.corp().finances.credits).toBe(T.filingFee - 1);
    expect((await request(c.app).get("/api/patents")).body.patents).toEqual([]);
  });
});

describe("ISP-235 the completion records are the server's", () => {
  it("the R&D tick stamps a completed node with its scheduled end", async () => {
    const c = await corp();
    const startedAt = Date.now() - 30 * HOUR;
    mutateAccountState(c.id, (s) => {
      s.queues.corporateRnD = [{ id: "rnd-t", techId: "tt-actinide-handling", name: "Actinide Handling", durationHours: 24, startedAt }];
    }, { sanitize: false, settleMining: false });
    processRndCompletions();
    expect(c.corp().unlockedTech).toContain("tt-actinide-handling");
    expect(c.corp().researchCompletedAt["tt-actinide-handling"]).toBe(startedAt + 24 * HOUR);
  });

  it("a run's delivery stamps the chain's first run, and a later run does not move it", async () => {
    const c = await corp();
    const endsAt = Date.now() - HOUR;
    const run = (at) => mutateAccountState(c.id, (s) => {
      s.corp.synthesisArrays = [{ id: "syn-1", name: "Synthesis Array", tier: 1, active: true, chainId: "catalyst-bed-chain", stationId: "earth-station-prime",
        cycleScale: 1, startedAt: at - 8 * HOUR, lastTickAt: at - 8 * HOUR, endsAt: at, cyclesCompleted: 0, totalInputConsumed: 0, totalOutputProduced: 0,
        inputs: [], outputs: [{ item: "Catalyst Beds", quantity: 5 }] }];
      applyRefineryOperations(s.corp, Date.now());
    }, { sanitize: false, settleMining: false });
    run(endsAt);
    expect(c.corp().chainFirstRunAt["catalyst-bed-chain"]).toBe(endsAt);
    run(endsAt + 30 * 60_000);
    expect(c.corp().chainFirstRunAt["catalyst-bed-chain"]).toBe(endsAt);
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { mutateAccountState, getAccountById } from "../../server/gameState.js";

// Bug #1258: the Corporate R&D page says one technology researches at a time, and every queued project ran at once.
// Through the real route and the real completion tick, with Date.now moved by hand for the tick. The route is always
// called at the real time: a clock moved hours ahead expires the login token. The tests run in dev mode, where the
// route stores a 0-hour duration, so each item's library duration (3 h and 4 h) is put back after queueing.
const H = 3_600_000;
let T0;

afterEach(() => vi.restoreAllMocks());

async function corporation() {
  const mod = await getApp();
  const { account, accessToken } = await registerAccount(mod.app);
  const api = authed(mod.app, accessToken);
  mutateAccountState(account.id, (s) => {
    s.corp.finances.credits = 50_000;
    s.corp.unlockedTech = ["tt-basic-extraction"];
    s.queues.corporateRnD = [];
  });
  const queue = (techId) => api.post(`/api/accounts/${account.id}/gameplay/queue-rnd`).send({ techId });
  const state = () => getAccountById(account.id).state;
  const setHours = (techId, hours) =>
    mutateAccountState(account.id, (s) => { s.queues.corporateRnD.find((i) => i.techId === techId).durationHours = hours; });
  return { mod, id: account.id, queue, state, setHours };
}

const clockAt = (ms) => { vi.restoreAllMocks(); vi.spyOn(Date, "now").mockReturnValue(ms); };
beforeEach(() => { T0 = Date.now(); });

describe("Corporate R&D runs one project at a time (Bug #1258)", () => {
  it("two projects queued together complete one after the other: at 3 h only the first, at 7 h both", async () => {
    const { mod, queue, state, setHours } = await corporation();
    clockAt(T0);
    expect((await queue("tt-industrial-safety")).status).toBe(200);
    setHours("tt-industrial-safety", 3);
    expect((await queue("tt-supply-forecast")).status).toBe(200);
    setHours("tt-supply-forecast", 4);
    expect(state().queues.corporateRnD.map((i) => i.startedAt)).toEqual([T0, T0 + 3 * H]);

    clockAt(T0 + 3 * H - 1);
    mod.processRndCompletions();
    expect(state().queues.corporateRnD).toHaveLength(2);

    clockAt(T0 + 3 * H);
    mod.processRndCompletions();
    expect(state().corp.unlockedTech).toEqual(["tt-basic-extraction", "tt-industrial-safety"]);
    expect(state().queues.corporateRnD.map((i) => i.techId)).toEqual(["tt-supply-forecast"]);

    clockAt(T0 + 7 * H - 1);
    mod.processRndCompletions();
    expect(state().queues.corporateRnD).toHaveLength(1);

    clockAt(T0 + 7 * H);
    mod.processRndCompletions();
    expect(state().corp.unlockedTech).toEqual(["tt-basic-extraction", "tt-industrial-safety", "tt-supply-forecast"]);
    expect(state().queues.corporateRnD).toEqual([]);
  });

  it("the same technology queued twice is refused and charged once", async () => {
    const { queue, state } = await corporation();
    clockAt(T0);
    expect((await queue("tt-industrial-safety")).status).toBe(200);
    const res = await queue("tt-industrial-safety");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already in the corporate R&D queue/);
    expect(state().queues.corporateRnD).toHaveLength(1);
    expect(state().corp.finances.credits).toBe(50_000 - 2_000);
  });

  it("a project queued after the one ahead has finished, but before the tick removed it, starts now", async () => {
    const { mod, id, queue, state, setHours } = await corporation();
    clockAt(T0);
    await queue("tt-industrial-safety");
    setHours("tt-industrial-safety", 3);
    // The head was queued five hours ago, so it finished two hours ago; no tick has run since.
    mutateAccountState(id, (s) => { s.queues.corporateRnD[0].startedAt = T0 - 5 * H; });

    expect((await queue("tt-supply-forecast")).status).toBe(200);
    setHours("tt-supply-forecast", 4);
    expect(state().queues.corporateRnD[1].startedAt).toBe(T0);

    mod.processRndCompletions();
    expect(state().queues.corporateRnD.map((i) => i.techId)).toEqual(["tt-supply-forecast"]);
    clockAt(T0 + 4 * H - 1);
    mod.processRndCompletions();
    expect(state().queues.corporateRnD).toHaveLength(1);
    clockAt(T0 + 4 * H);
    mod.processRndCompletions();
    expect(state().corp.unlockedTech).toContain("tt-supply-forecast");
  });

  it("research queued before the fix, running in parallel, is kept, charged once and pushed back behind the item ahead", async () => {
    const { mod, id, state } = await corporation();
    const before = state().corp.finances.credits;
    // Two items saved the old way: both stamped with the moment they were queued, so both would finish by T0 + 4 h.
    mutateAccountState(id, (s) => {
      s.queues.corporateRnD = [
        { id: "rnd-old", techId: "tt-industrial-safety", name: "Industrial Safety", effect: "", durationHours: 3, startedAt: T0, costCredits: 2000 },
        { id: "rnd-old", techId: "tt-supply-forecast", name: "Supply Forecast", effect: "", durationHours: 4, startedAt: T0, costCredits: 3000 }
      ];
    });

    clockAt(T0 + 4 * H);
    mod.processRndCompletions();
    // The head is done; the second, which shares the head's id, was not removed with it and now ends at 7 h, not 4 h.
    expect(state().corp.unlockedTech).toEqual(["tt-basic-extraction", "tt-industrial-safety"]);
    expect(state().queues.corporateRnD.map((i) => [i.techId, i.startedAt])).toEqual([["tt-supply-forecast", T0 + 3 * H]]);
    expect(state().corp.finances.credits).toBe(before);

    clockAt(T0 + 7 * H);
    mod.processRndCompletions();
    expect(state().corp.unlockedTech).toContain("tt-supply-forecast");
    expect(state().corp.finances.credits).toBe(before);
  });
});

// AB#2476 (Board review item 23): the queue holds the technology in progress and one more behind it. The queue is
// seeded as a player would have left it, and the third technology goes through the real route at the real time.
describe("Corporate R&D holds the research in progress and one behind it (AB#2476)", () => {
  const seeded = (techId, name, durationHours, startedAt) => ({ id: `rnd-${techId}`, techId, name, effect: "", durationHours, startedAt, costCredits: 3000 });

  it("a third technology, with one running and one waiting, is refused with when a place opens, and nothing is charged", async () => {
    const { id, queue, state } = await corporation();
    clockAt(T0);
    mutateAccountState(id, (s) => {
      s.queues.corporateRnD = [
        seeded("tt-supply-forecast", "Supply Forecast Engine", 4, T0 - H), // running, 3 h left
        seeded("tt-energy-routing", "High-Density Energy Routing", 6, T0 + 3 * H) // waiting behind it
      ];
    });
    const res = await queue("tt-industrial-safety");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Corporate R&D runs one technology and holds one more behind it. Industrial Safety Protocols can be queued once Supply Forecast Engine finishes, in 3h 0m.");
    expect(state().queues.corporateRnD.map((i) => i.techId)).toEqual(["tt-supply-forecast", "tt-energy-routing"]);
    expect(state().corp.finances.credits).toBe(50_000);
  });

  it("when the one in progress completes, the waiting one runs and a new one can be queued behind it", async () => {
    const { mod, id, queue, state } = await corporation();
    clockAt(T0);
    mutateAccountState(id, (s) => {
      s.queues.corporateRnD = [
        seeded("tt-supply-forecast", "Supply Forecast Engine", 4, T0 - 4 * H), // finished at T0
        seeded("tt-energy-routing", "High-Density Energy Routing", 6, T0) // starts as it finishes
      ];
    });
    mod.processRndCompletions();
    expect(state().corp.unlockedTech).toContain("tt-supply-forecast");
    expect(state().queues.corporateRnD.map((i) => i.techId)).toEqual(["tt-energy-routing"]);

    const res = await queue("tt-industrial-safety");
    expect(res.status).toBe(200);
    expect(state().queues.corporateRnD.map((i) => [i.techId, i.startedAt])).toEqual([["tt-energy-routing", T0], ["tt-industrial-safety", T0 + 6 * H]]);
    expect(state().corp.finances.credits).toBe(50_000 - 2_000);
  });
});

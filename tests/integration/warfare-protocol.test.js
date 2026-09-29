import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { getAccountById, listAccountNotifications, mutateAccountState, mutateState } from "../../server/gameState.js";
import { allStations } from "../../server/game/stations.js";
import { declareHunt, resolveHunts } from "../../server/hunts.js";
import { refusalMeaning } from "../../public/scripts/protocol.js";
import { huntReportHtml, beltRatsHtml } from "../../public/scripts/ratsOverlay.js";

// ISP-255d (AB#4826): hunts' notices, refusals and statuses carry the protocol line. A hunt refused for its provisions
// sends the code, so it reads as Unfunded, and says what to do next; a hunt won is Concluded, one lost Unsuccessful.
const WOLF = "wolf-359", WOLF_BELT = "wolf-359:wf-shards";
const station = () => allStations().find((s) => s.systemId === WOLF).id;

async function hunter(credits, units) {
  const { app } = await getApp();
  const reg = await registerAccount(app);
  mutateAccountState(reg.account.id, (s) => {
    s.corp.finances.credits = credits;
    s.corp.currentSystemId = WOLF;
    s.corp.currentStationId = station();
    s.corp.military = { units: { lf: 0, ds: 0, se: 0, at: 0, dt: 0, ...units }, readiness: 100, fleets: [{ id: "flt-a", name: "Aegis", units: { ...units }, stationId: station(), transit: null, formedAt: Date.now() }] };
  }, { sanitize: false, settleMining: false });
  mutateState((d) => { if (d.rats?.quiet) d.rats.quiet = {}; });
  return { id: reg.account.id, api: authed(app, reg.accessToken), at: (p) => `/api/accounts/${reg.account.id}/gameplay${p}` };
}
const noticeTitled = (id, title) => listAccountNotifications(id).notifications.find((n) => n.title === title);

describe("hunts in protocol language (ISP-255d, AB#4826)", () => {
  it("a hunt refused for its provisions reads as Unfunded and says what to do next", async () => {
    const h = await hunter(100, { ds: 6, at: 6 });
    const res = await h.api.post(h.at("/fleets/flt-a/hunt")).send({ beltKey: WOLF_BELT });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient-credits");
    expect(refusalMeaning(Object.assign(new Error(res.body.error), { code: res.body.code }))).toBe("unfunded");
    expect(res.body.error).toMatch(/; you have 100\. Send a smaller fleet, or sell goods to raise the credits\.$/);
  });

  it("a hunt won is Concluded and one lost is Unsuccessful, in the notice and the report", async () => {
    const won = await hunter(1_000_000, { ds: 6, at: 6 });
    const w = declareHunt(won.id, { fleetId: "flt-a", beltKey: WOLF_BELT });
    const [report] = resolveHunts(won.id, w.hunt.endsAt);
    expect(report.outcome).toBe("attacker");
    expect(noticeTitled(won.id, "Hunt won").protocol).toEqual({ meaning: "complete", screen: "starmap" });
    expect(huntReportHtml(report)).toContain("Concluded");

    const lost = await hunter(1_000_000, { lf: 2 });
    const l = declareHunt(lost.id, { fleetId: "flt-a", beltKey: WOLF_BELT });
    const [bad] = resolveHunts(lost.id, l.hunt.endsAt);
    expect(bad.outcome).not.toBe("attacker");
    const notice = listAccountNotifications(lost.id).notifications.find((n) => /^Hunt (lost|broke off|found nothing)$/.test(n.title));
    expect(notice.protocol).toEqual({ meaning: "failed", screen: "starmap" });
    expect(huntReportHtml(bad)).toContain("Unsuccessful");
  });

  it("a hunt under way and a quiet belt read In force", () => {
    const html = beltRatsHtml({ beltKey: WOLF_BELT, reading: null, quiet: { until: Date.now() + 3_600_000 }, hunting: [{ fleetId: "flt-a", fleetName: "Aegis", endsAt: Date.now() + 60_000 }] });
    expect(html.match(/In force/g)).toHaveLength(2);
  });
});

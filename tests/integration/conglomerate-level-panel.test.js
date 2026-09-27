import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount, authed } from "../helpers/api.js";
import { accountsStore } from "../../server/game/store.js";
import { findConglomerate, inviteCorporation, answerInvitation } from "../../server/game/membership.js";
import { depositToTreasury } from "../../server/game/treasury.js";
import { CONGLOMERATE_CATALOG as C } from "../../server/conglomerates.js";
import { levelHtml } from "../../public/scripts/conglomerateBureau.js";
import { actionReceiptView } from "../../public/scripts/actionReceipt.js";

// ISP-203 (AB#897): the level panel draws what the server's levelStatus says, at two levels of one test conglomerate;
// the upgrade button is disabled with each reason when the server would refuse; and a level-up is shown to each member
// once, then not again after the member says it has seen it.
const DAY = 86_400_000;
let seq = 0;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function corporation(app) {
  const reg = await registerAccount(app);
  const raw = accountsStore.accounts[reg.account.id];
  raw.createdAt = Date.now() - (C.minFounderAgeDays + 1) * DAY;
  raw.state.corp.currentStationId = C.charterStationId;
  raw.state.corp.finances.credits = 400_000;
  return { id: reg.account.id, raw, api: authed(app, reg.accessToken), base: `/api/accounts/${reg.account.id}` };
}

describe("the level panel and the level-up overlay (AB#897)", () => {
  it("shows the server's requirements at level 1 and level 2, and each member sees the level-up once", async () => {
    const { app } = await getApp();
    const founder = await corporation(app);
    const res = await founder.api.post(`${founder.base}/conglomerates`).send({ name: `Panel ${Date.now() % 1e6} ${(seq += 1)}`, emblem: 1, colour: 1 });
    expect(res.status).toBe(201);
    const c = findConglomerate(res.body.conglomerate.id);
    const members = [];
    for (let i = 0; i < 3; i++) {
      const m = await corporation(app);
      const inv = inviteCorporation(founder.id, c.id, m.raw.state.corp.publicId);
      expect(answerInvitation(m.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined();
      members.push(m);
    }
    members[0].raw.state.corp.currentStationId = "mars-orbital-dock";
    const read = async (who) => {
      const view = (await who.api.get(`${who.base}/conglomerate`)).body;
      return { ...view, me: who.raw.state.corp.publicId, atBureau: who.raw.state.corp.currentStationId === C.charterStationId };
    };

    // level 1, not ready: the treasury is short and the days are not served; every figure is the server's
    let view = await read(founder);
    let html = levelHtml(view);
    for (const r of view.conglomerate.levels.requirements) expect(html).toContain(`data-requirement="${r.id}"`);
    const funds = view.conglomerate.levels.requirements.find((r) => r.id === "funds");
    expect(text(html)).toContain(`${funds.have.toLocaleString("en-US")} of ${funds.need.toLocaleString("en-US")}`);
    expect(text(html)).toContain(`Level 2 makes room for 10. It costs 50,000 credits from the treasury, which must keep ${(funds.need - 50_000).toLocaleString("en-US")} more`);
    expect(html).toMatch(/data-role="cong-level-buy"[^>]*disabled/);
    expect(text(html)).toMatch(/2 of the 4 requirements above are not met yet/);

    // ready: funded and the days served (levelSince moved back, as waiting would)
    expect(depositToTreasury(founder.id, c.id, 60_000).refused).toBeUndefined();
    c.levelSince = Date.now() - 4 * DAY;
    view = await read(founder);
    html = levelHtml(view);
    expect(view.conglomerate.levels.ready).toBe(true);
    expect(html).not.toMatch(/data-role="cong-level-buy"[^>]*disabled/);
    expect(html).not.toContain("cong-level-why");
    // a member away from the Bureau without the permission: disabled, with both reasons
    const memberHtml = text(levelHtml(await read(members[0])));
    expect(memberHtml).toContain("Only the founder buys a level");
    expect(memberHtml).toContain("Earth Station Prime");

    // buy level 2; every member has it to see once
    expect((await founder.api.post(`${founder.base}/conglomerates/${c.id}/level`).send({ level: 2 })).status).toBe(200);
    view = await read(founder);
    expect(view.conglomerate.levelReached).toBe(2);
    expect((await read(members[1])).conglomerate.levelReached).toBe(2);
    expect(actionReceiptView({ conglomerateLevel: { name: c.name, level: 2, maxMembers: 10, next: { level: 3, maxMembers: 15 } } }))
      .toMatchObject({ variant: "milestone", title: `${c.name} reached level 2` });

    // level 2's panel: the server's next level and requirements
    html = levelHtml(view);
    expect(text(html)).toContain("Level 2 · room for 10 members, 4 now");
    expect(text(html)).toContain("Level 3 makes room for 15. It costs 75,000 credits");
    const members2 = view.conglomerate.levels.requirements.find((r) => r.id === "members");
    expect(text(html)).toContain(`${members2.have} of ${members2.need}`);

    // seen: cleared for the founder only, and not back on the next read
    expect((await founder.api.post(`${founder.base}/conglomerates/${c.id}/level-seen`).send({ level: 2 })).body).toEqual({ levelReached: null });
    expect((await read(founder)).conglomerate.levelReached).toBeNull();
    expect((await read(members[1])).conglomerate.levelReached).toBe(2);
    // a member who joins after the level-up has nothing to see
    const late = await corporation(app);
    const inv = inviteCorporation(founder.id, c.id, late.raw.state.corp.publicId);
    expect(answerInvitation(late.id, c.id, inv.invitation.id, "accept").refused).toBeUndefined();
    expect((await read(late)).conglomerate.levelReached).toBeNull();
  });
});

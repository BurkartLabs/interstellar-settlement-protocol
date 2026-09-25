// AB#1295: a returning expedition's notification and inbox report name the belt, its system and the deposit station,
// not their ids. Driven through the real tick on a registered account.
import { describe, it, expect } from "vitest";
import { getApp } from "../helpers/app.js";
import { registerAccount } from "../helpers/api.js";
import { mutateAccountState, listAccountNotifications, listAccountMessages } from "../../server/gameState.js";
import { asteroidExpeditionTick } from "../../server/ticks.js";

describe("an expedition's return, as the player reads it (AB#1295)", () => {
  it("names the Centauri Belt, Alpha Centauri and the station, and no id", async () => {
    const { app } = await getApp();
    const { account } = await registerAccount(app);
    const now = Date.now();
    mutateAccountState(account.id, (state) => {
      state.corp.asteroidMining = {
        probeCount: 0,
        activeExpeditions: [{
          id: "exp-1295", beltKey: "alpha-centauri:ac-belt", systemId: "alpha-centauri", duration: "short",
          deployedAt: now - 60_000, lastTickAt: now - 60_000, completesAt: now - 1_000, yields: {}, status: "active"
        }]
      };
    }, { sanitize: false, settleMining: false });

    asteroidExpeditionTick();

    const note = listAccountNotifications(account.id).notifications.find((n) => n.title === "Expedition Complete");
    expect(note, "an Expedition Complete notification").toBeTruthy();
    expect(note.body).toMatch(/^Mining probe has returned from the Centauri Belt \(Alpha Centauri\)\. /);
    expect(note.body).toMatch(/Resources deposited at [A-Z][^.]*\.$/);

    const report = listAccountMessages(account.id).find((m) => /Mining Probe Return/.test(m.subject || ""));
    expect(report, "the Mineral Survey report").toBeTruthy();
    expect(report.subject).toMatch(/^Mining Probe Return — Centauri Belt \[/);
    expect(report.body).toContain("from the Centauri Belt asteroid field, Alpha Centauri system");

    for (const text of [note.body, report.subject, report.body]) {
      expect(text).not.toMatch(/ac-belt|alpha-centauri|Ac Belt|-station|-dock|-orbital/);
    }
  });
});

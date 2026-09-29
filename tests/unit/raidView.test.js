import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { setSectionCodes } from "../../public/scripts/sectionCodes.js";
import { battleReportHtml, countdown, garrisonPanelHtml, incomingAlertHtml, outgoingRaidsHtml, targetPickerHtml } from "../../public/scripts/raidView.js";

// ISP-181 (AB#875): the raid screens' markup, text first. The figures are what the server returns.
const NOW = Date.UTC(2026, 8, 27, 10, 0);
const HOUR = 3_600_000;
const CATALOG = [{ id: "lf", name: "Light Fighter" }, { id: "ds", name: "Destroyer" }, { id: "se", name: "Siege Engine" }, { id: "at", name: "Attack Troops" }, { id: "dt", name: "Defense Troops" }];
const stationName = (id) => ({ "earth-station-prime": "Earth Station Prime", "luna-gateway": "Luna Gateway" })[id] || id;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const INCOMING = [{ id: "raid-1", attackerName: "Vanta Corsairs", targetStationId: "earth-station-prime", arrivesAt: NOW + 2 * HOUR - 5 * 60_000, units: { ds: 8, at: 16 } }];

describe("ISP-181 the incoming-raid alert", () => {
  it("names the attacker, the station and the arrival with a countdown, and routes to the garrison in one click", () => {
    const html = incomingAlertHtml(INCOMING, { now: NOW, stationName, catalog: CATALOG });
    const t = text(html);
    expect(t).toContain("Vanta Corsairs is raiding your holdings at Earth Station Prime");
    expect(t).toMatch(/arrives in 1 h 55 min \(11:55 UTC\)/);
    expect(t).toContain("8 Destroyers, 16 squads of Attack Troops");
    expect(html).toContain('data-raid-defend="earth-station-prime"');
    expect(html).toContain('role="alert"');
    expect(incomingAlertHtml([], { now: NOW, stationName })).toBe("");
    expect(countdown(NOW - 1, NOW)).toBe("arriving");
  });
});

describe("ISP-181 the garrison panel", () => {
  it("shows troops, troops on the way, the threat, the posture chosen, and a reinforce form from other garrisons", () => {
    const corp = { military: { garrisons: { "earth-station-prime": 10, "luna-gateway": 3 } }, garrisonPostures: { "earth-station-prime": "fortified" }, garrisonMoves: [{ toStationId: "earth-station-prime", quantity: 2, arrivesAt: NOW + HOUR }] };
    const html = garrisonPanelHtml(corp, ["earth-station-prime"], { stationName, now: NOW, incoming: INCOMING });
    const t = text(html);
    expect(t).toContain("Defense troops 10, and 2 on the way (11:00 UTC)");
    expect(t).toContain("Raid arrives 1 h 55 min");
    expect(html).toMatch(/value="fortified" checked/);
    expect(html).toContain('id="garrison-earth-station-prime"');
    expect(html).toMatch(/<option value="luna-gateway">Luna Gateway \(3\)<\/option>/);
    expect(text(garrisonPanelHtml(corp, [], { stationName }))).toContain("nothing to defend");
  });
});

describe("ISP-181 the target picker", () => {
  const fleets = [{ id: "f1", name: "Corsair", stationId: "luna-gateway", units: { ds: 6, at: 12 } }, { id: "f2", name: "Talon", stationId: null, transit: {}, units: { lf: 4 } }];
  it("offers Raid only on eligible targets, and says why the others are not", () => {
    const list = { stationId: "earth-station-prime", you: [], targets: [
      { corpId: "c1", name: "Orion Salvage", eligible: true, reasons: [] },
      { corpId: "c2", name: "Newco Mining", eligible: false, reasons: [{ kind: "protected", daysLeft: 5, text: "New-player protection: 5 day(s) left." }] },
      { corpId: "c3", name: "Rigel Works", eligible: false, reasons: [{ kind: "cooldown", until: NOW + 20 * HOUR, text: "Raided recently: protected until its cooldown ends." }] },
      { corpId: "c4", name: "Drift Co", eligible: false, reasons: [{ kind: "repeat", until: NOW + 4 * 24 * HOUR, text: "You have raided it 2 times in 7 days." }] }
    ] };
    const html = targetPickerHtml({ fleets, stationId: "earth-station-prime", stations: ["earth-station-prime", "luna-gateway"], list, stationName, catalog: CATALOG });
    expect(html.match(/data-raid-target=/g)).toHaveLength(1);
    const t = text(html);
    expect(t).toContain("New-player protection: 5 day(s) left.");
    expect(t).toContain("Raided recently: protected until its cooldown ends. (2147-09-28 06:00 UTC)");
    expect(t).toContain("You have raided it 2 times in 7 days. (2147-10-01 10:00 UTC)");
    expect(html.match(/<option value="f\d"/g)).toEqual(['<option value="f1"']); // a travelling fleet cannot be chosen
  });

  it("says why the caller cannot raid at all, and what to do without a fleet", () => {
    const you = [{ kind: "protected", text: "Your corporation cannot raid for 3 more day(s): new-player protection." }];
    expect(text(targetPickerHtml({ fleets, stationId: "earth-station-prime", stations: [], list: { you, targets: [] }, stationName }))).toContain("cannot raid for 3 more day(s)");
    expect(text(targetPickerHtml({ fleets: [], stationName }))).toContain("Form a fleet");
  });
});

describe("ISP-181 your raids and the report", () => {
  it("lists raids with a countdown and Recall while inbound, and a Report once there is one", () => {
    const html = outgoingRaidsHtml([{ id: "r1", targetName: "Drift Co", targetStationId: "earth-station-prime", state: "inbound", declaredAt: NOW - HOUR, arrivesAt: NOW + 3 * HOUR }, { id: "r2", targetName: "Orion Salvage", targetStationId: "earth-station-prime", state: "completed", declaredAt: NOW - 9 * HOUR, arrivesAt: NOW - 5 * HOUR }], { now: NOW, stationName, reports: [{ raidId: "r2" }] });
    expect(html).toContain('data-raid-recall="r1"');
    expect(html).toContain('data-raid-report="r2"');
    expect(html).not.toContain('data-raid-recall="r2"');
  });
  it("ISP-254 (AB#4817): each raid's plain state carries its protocol line on the Fleet screen", () => {
    const at = (state) => outgoingRaidsHtml([{ id: "r", targetName: "Drift Co", targetStationId: "earth-station-prime", state, declaredAt: NOW - HOUR, arrivesAt: NOW + HOUR, returnsAt: NOW + 2 * HOUR }], { now: NOW, stationName });
    expect(at("inbound")).toMatch(/arrives in .*In force/s);
    expect(at("resolved")).toMatch(/on its way home .*Concluded/s);
    expect(at("recalled")).toMatch(/called off .*Withdrawn/s);
    expect(at("completed")).toMatch(/done .*Concluded/s);
    setSectionCodes(JSON.parse(readFileSync("data/section-codes.json", "utf8")));
    expect(at("inbound")).toContain("CORP-MIL-1");
    setSectionCodes(null);
  });

  it("the defender's report: outcome, forces and losses per side, the rounds to the nearest unit, goods lost, building damage and repair", () => {
    const report = {
      raidId: "r9", side: "defender", at: NOW - HOUR, station: "Earth Station Prime", winner: "attacker", posture: "balanced",
      attacker: { name: "Helios Freight", before: { lf: 10, ds: 14, se: 8, at: 24 }, lost: { at: 2 } },
      defender: { name: "Kestrel Holdings", before: { lf: 4, dt: 10 }, lost: { lf: 4, dt: 10 } },
      rounds: [{ round: 1, attacker: { remaining: { lf: 9.72, ds: 13.92, se: 7.91, at: 22.3 } }, defender: { remaining: {} } }],
      loot: { Silicates: 528, "Iron Ore": 211 },
      buildingsDamaged: [{ name: "Refinery", before: 100, after: 80, repairCost: 2_000 }]
    };
    const t = text(battleReportHtml(report, { catalog: CATALOG }));
    expect(t).toContain("The raid succeeded");
    expect(t).toContain("Helios Freight raided Kestrel Holdings at Earth Station Prime");
    expect(t).toContain("Light Fighter 10 0 4 4");
    expect(t).toContain("Defense Troops 0 0 10 10");
    expect(t).toContain("10 Light Fighter, 14 Destroyer, 8 Siege Engine, 22 Attack Troops");
    expect(t).toContain("528 Silicates");
    expect(t).toContain("Refinery: condition 100 to 80; repair 2,000 credits");
    // the attacker sees the damage it did, never the defender's repair bill
    const theirs = text(battleReportHtml({ ...report, side: "attacker", buildingsDamaged: [{ name: "Refinery", points: 20 }] }, { catalog: CATALOG }));
    expect(theirs).toContain("Refinery: 20 condition points");
    expect(theirs).toContain("Goods taken");
  });
});

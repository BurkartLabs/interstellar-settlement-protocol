import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { claimsAllTakenText, claimsNoLeasesText, inboxEmptyText } from "../../public/scripts/emptyStates.js";

// Bug #1060: empty states stated a fact or pointed at a form the player could not use yet. Each now names what to do.
const stationsJson = JSON.parse(readFileSync(new URL("../../data/stations.json", import.meta.url), "utf8"));
const STATIONS = Array.isArray(stationsJson) ? stationsJson : stationsJson.stations;
const OFFERED = ["Earth", "Mars", "Luna"]; // the bodies the claims office leases (app.js LEASE_BODIES)

describe("the Inbox names what to do when a folder is empty (Bug #1060)", () => {
  it("has its own line for each folder and subtab, and none says only 'No messages here.'", () => {
    const cases = [["inbox", "official"], ["inbox", "players"], ["sent"], ["draft"], ["archive"], ["trash"]];
    const lines = cases.map(([folder, subtype]) => inboxEmptyText(folder, subtype));
    expect(new Set(lines).size).toBe(cases.length);
    expect(lines).not.toContain("No messages here.");
    expect(inboxEmptyText("inbox", "players")).toBe("No player mail yet. Compose to write to another corporation.");
    expect(inboxEmptyText("sent")).toMatch(/Compose/);
  });
});

describe("ISA Claims does not point at a form that is not there (Bug #1060)", () => {
  it("without an office it no longer says 'submit a lease application below'", () => {
    expect(claimsNoLeasesText(false)).toBe("No active extraction claims on file.");
    expect(claimsNoLeasesText(false)).not.toMatch(/below/);
    expect(claimsNoLeasesText(true)).toBe("No active extraction claims on file. File a lease application below to begin.");
  });
});

describe("after the local lease, ISA Claims says where the others are filed (Bug #1060)", () => {
  it("names the other bodies and their stations, from the station registry", () => {
    const text = claimsAllTakenText({ offeredBodies: OFFERED, ownedBodies: ["Earth"], stations: STATIONS });
    const mars = STATIONS.find((s) => s.body === "Mars").name;
    const luna = STATIONS.find((s) => s.body === "Luna").name;
    expect(text).toBe(`Your corporation holds this station's lease. Other bodies are leased from the station that orbits them: Mars from ${mars}, Luna from ${luna}.`);
  });

  it("leaves out every body already held, wherever the corporation is docked", () => {
    const text = claimsAllTakenText({ offeredBodies: OFFERED, ownedBodies: ["Earth", "Mars"], stations: STATIONS });
    expect(text).not.toMatch(/Mars from/);
    expect(text).toMatch(/Luna from/);
  });

  it("says so when every lease is held", () => {
    expect(claimsAllTakenText({ offeredBodies: OFFERED, ownedBodies: OFFERED, stations: STATIONS })).toBe("Your corporation holds every extraction lease the ISA offers.");
  });
});

describe("the Exchange's empty inventory names how to get goods (Bug #1060)", () => {
  it("points at ISA Claims & Leases", () => {
    const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
    const line = html.match(/<p id="market-sell-empty"[^>]*>([^<]*)<\/p>/)[1];
    expect(line).not.toBe("You have no items in inventory to list.");
    expect(line).toMatch(/ISA Claims &amp; Leases/);
  });
});

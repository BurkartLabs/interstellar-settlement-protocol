import { describe, it, expect } from "vitest";
import { activeOfficeAt } from "../../public/scripts/officeStatus.js";
import { activeOfficeAt as serverActiveOfficeAt } from "../../server/routes/helpers.js";

it("the server's routes re-export this exact function, not a second copy of it (T-003)", () => {
  expect(serverActiveOfficeAt).toBe(activeOfficeAt);
});

// AB#1870: the one copy of "does this corporation have a usable office at this station right now" — the server's
// routes (server/routes/helpers.js re-exports this exact function) and the claims/leases and walkthrough pages
// all read it, so it cannot drift into two answers again.
describe("activeOfficeAt (AB#1124, AB#1870)", () => {
  const NOW = 1_000_000;

  it("is null with no offices at all", () => {
    expect(activeOfficeAt({ offices: [] }, "mars-orbital-dock", NOW)).toBeNull();
    expect(activeOfficeAt({}, "mars-orbital-dock", NOW)).toBeNull();
  });

  it("is null when the corporation's office is at a different station", () => {
    const corp = { offices: [{ stationId: "earth-station-prime", rentedUntil: NOW + 1000 }] };
    expect(activeOfficeAt(corp, "mars-orbital-dock", NOW)).toBeNull();
  });

  it("is null when the office at this station has lapsed", () => {
    const corp = { offices: [{ stationId: "mars-orbital-dock", rentedUntil: NOW - 1 }] };
    expect(activeOfficeAt(corp, "mars-orbital-dock", NOW)).toBeNull();
  });

  it("returns the office when it is at this station and not lapsed", () => {
    const office = { stationId: "mars-orbital-dock", rentedUntil: NOW + 1000 };
    const corp = { offices: [{ stationId: "earth-station-prime", rentedUntil: NOW + 1000 }, office] };
    expect(activeOfficeAt(corp, "mars-orbital-dock", NOW)).toBe(office);
  });

  it("is null with no stationId to check", () => {
    const corp = { offices: [{ stationId: "mars-orbital-dock", rentedUntil: NOW + 1000 }] };
    expect(activeOfficeAt(corp, null, NOW)).toBeNull();
  });
});

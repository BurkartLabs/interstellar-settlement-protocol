// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// AB#1870: the ISA Claims & Leases Division offered a lease at any station as long as the corporation had an
// office *anywhere*, ever — renderISAClaimsLeases computed hasOffice from the raw offices array while the server's
// purchase-lease route (AB#1124) refuses unless an office is active at *this* station. A corporation with only an
// Earth office, docked at Mars, saw the full application form and an enabled File button for a request the server
// would refuse. Both now read the one shared activeOfficeAt (public/scripts/officeStatus.js).
vi.mock("../../public/scripts/views/shared.js", () => ({
  formatSystemLabel: () => "",
  getCurrentStationInfo: vi.fn(),
  pushFeedback: vi.fn(),
  revealUnderHeader: () => {},
  setTab: () => {},
  showTradeConfirmation: () => {},
  stationLocationBanner: () => "",
  updateAllViews: () => {}
}));
vi.mock("../../public/scripts/views/assignments.js", () => ({ renderMissions: () => {} }));

const { renderISAClaimsLeases } = await import("../../public/scripts/views/station.js");
const { getCurrentStationInfo } = await import("../../public/scripts/views/shared.js");

const BUILDING = { factionCode: "ISA-CL", name: "ISA Claims & Leases Division", description: "", flavor: "" };
const MARS = { id: "mars-orbital-dock", name: "Mars Orbital Dock", body: "Mars" };
const NOW = Date.now();

function corpWith(offices) {
  return { offices, miningLeases: [], employeeCount: 10, finances: { credits: 1_000_000 } };
}

describe("ISA Claims & Leases: the office gate agrees with the server (AB#1870)", () => {
  it("does not offer a lease at Mars when the only office is at Earth", () => {
    getCurrentStationInfo.mockReturnValue(MARS);
    const corp = corpWith([{ stationId: "earth-station-prime", rentedUntil: NOW + 1000 }]);

    const html = renderISAClaimsLeases(BUILDING, { corp });

    expect(html).not.toMatch(/File Lease Application/);
    expect(html).toMatch(/office at Mars Orbital Dock is required/);
  });

  it("offers a lease at Mars once the corporation has a Mars office, even alongside an Earth one", () => {
    getCurrentStationInfo.mockReturnValue(MARS);
    const corp = corpWith([
      { stationId: "earth-station-prime", rentedUntil: NOW + 1000 },
      { stationId: "mars-orbital-dock", rentedUntil: NOW + 1000 }
    ]);

    const html = renderISAClaimsLeases(BUILDING, { corp });

    expect(html).toMatch(/File Lease Application/);
    expect(html).not.toMatch(/office at Mars Orbital Dock is required/);
  });

  it("does not offer a lease at Mars when the Mars office has lapsed", () => {
    getCurrentStationInfo.mockReturnValue(MARS);
    const corp = corpWith([{ stationId: "mars-orbital-dock", rentedUntil: NOW - 1 }]);

    const html = renderISAClaimsLeases(BUILDING, { corp });

    expect(html).not.toMatch(/File Lease Application/);
    expect(html).toMatch(/office at Mars Orbital Dock is required/);
  });
});

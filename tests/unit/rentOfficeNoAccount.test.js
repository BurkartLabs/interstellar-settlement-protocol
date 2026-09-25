// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// AB#1825: the rent-office handler's no-account branch built the office with `body: currentBody`, a const that only
// exists inside renderOrbitalExecutiveSuites. Clicking Execute Lease Agreement there threw a ReferenceError, which the
// handler's own catch showed as a failed lease. The branch is unreachable from today's entry points (every enterGame
// passes an account id), so this drives the handler directly.
vi.mock("../../public/scripts/views/shared.js", () => ({
  formatSystemLabel: () => "",
  getCurrentStationInfo: () => null,
  pushFeedback: vi.fn(),
  revealUnderHeader: () => {},
  setTab: () => {},
  showTradeConfirmation: () => {},
  stationLocationBanner: () => "",
  updateAllViews: () => {}
}));
vi.mock("../../public/scripts/views/assignments.js", () => ({ renderMissions: () => {} }));

const { bindOfficeActions } = await import("../../public/scripts/views/station.js");
const { appState } = await import("../../public/scripts/state.js");

describe("renting an office with no account signed in (AB#1825)", () => {
  it("records the office on the body its station orbits, and reports no error", async () => {
    document.body.innerHTML = `
      <div id="station-building-content"></div>
      <select id="rent-office-duration"><option value="7" selected>7</option></select>
      <button id="rent-office-btn">Execute Lease Agreement</button>
      <p id="rent-office-status"></p>`;
    appState.accountId = null;
    appState.stationRegistry = [{ id: "mars-orbital", name: "Mars Orbital", body: "Mars", systemId: "sol", tier: 1 }];
    appState.data = { corp: { currentStationId: "mars-orbital", location: "Earth", finances: { credits: 100_000 }, offices: [] } };

    bindOfficeActions({ id: "orbital-executive-suites" }, appState.data);
    document.getElementById("rent-office-btn").click();
    await vi.waitFor(() => expect(appState.data.corp.offices).toHaveLength(1));

    expect(document.getElementById("rent-office-status").textContent).not.toMatch(/not defined|failed/i);
    expect(appState.data.corp.offices[0]).toMatchObject({ stationId: "mars-orbital", body: "Mars", durationDays: 7 });
  });
});

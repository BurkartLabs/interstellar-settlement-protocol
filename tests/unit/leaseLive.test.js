import { describe, it, expect } from "vitest";
import { activeCycleFigures, extractorState } from "../../public/scripts/leaseLive.js";
import { clientCode } from "../helpers/clientSource.js";

// Bug #1091: the open lease view refreshes a running extractor's figures from mining:updated, with the same
// functions it draws them with.
const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;
const running = { active: true, startedAt: T0, endsAt: T0 + 4 * HOUR, operationCostPerHour: 4000, minedThisCycle: 37 };

describe("a running extractor's figures (Bug #1091)", () => {
  it("are the server's per-cycle count, the progress, the time left and the fees so far", () => {
    expect(activeCycleFigures(running, T0 + HOUR)).toEqual({ pct: 25, hrs: 3, mins: 0, mined: 37, fees: 4000 });
    expect(activeCycleFigures({ ...running, minedThisCycle: 112 }, T0 + 2.5 * HOUR)).toEqual({ pct: 63, hrs: 1, mins: 30, mined: 112, fees: 10000 });
  });

  it("stay within the cycle before its start and after its end", () => {
    expect(activeCycleFigures(running, T0 - HOUR)).toMatchObject({ pct: 0, fees: 0 });
    expect(activeCycleFigures(running, T0 + 9 * HOUR)).toMatchObject({ pct: 100, hrs: 0, mins: 0, fees: 16000 });
  });

  it("name the state that decides the row's layout", () => {
    expect(extractorState(running)).toBe("active");
    expect(extractorState({ ...running, downtimeActive: true })).toBe("downtime");
    expect(extractorState({ active: false })).toBe("idle");
  });

  it("the mining:updated handler refreshes the open lease view", () => {
    const app = clientCode(); // AB#739: the handler is in app.js, the lease view it refreshes in views/station.js
    const handler = app.slice(app.indexOf('socket.on("mining:updated"'), app.indexOf('socket.on("expedition:completed"'));
    expect(handler).toContain("refreshOpenLeaseView(payload.extractors)");
    for (const key of ["pct", "left", "mined", "fees", "fill"]) expect(app).toContain(`data-live="${key}"`);
  });
});

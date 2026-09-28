import { describe, it, expect } from "vitest";
import { SIDEBAR_STORAGE_KEY, blockExpanded, groupExpanded, noteTabOpened, readSidebarState, writeSidebarState } from "../../public/scripts/sidebarState.js";

// AB#2481: the left column's sections collapse, and the player's choices are remembered (localStorage).
const memory = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data };
};
const fresh = () => ({ groups: {}, blocks: {} });

describe("the left column's sections (AB#2481)", () => {
  it("until the player chooses, only the open tab's group is expanded", () => {
    const state = fresh();
    expect(groupExpanded(state, "company", "company")).toBe(true);
    for (const g of ["station", "industry", "market", "comms", "map"]) expect(groupExpanded(state, g, "company")).toBe(false);
  });

  it("a group the player expanded stays expanded, and one they collapsed stays collapsed, wherever they go", () => {
    const state = { groups: { market: true, company: false }, blocks: {} };
    expect(groupExpanded(state, "market", "station")).toBe(true);
    expect(groupExpanded(state, "company", "company")).toBe(false);
  });

  it("opening a tab shows its group again, even one the player collapsed", () => {
    const state = { groups: { company: false, market: true }, blocks: {} };
    expect(noteTabOpened(state, "inbox")).toBe(true);
    expect(groupExpanded(state, "company", "company")).toBe(true);
    expect(noteTabOpened(state, "assets")).toBe(false); // already expanded: nothing to change
    expect(state.groups.market).toBe(true);
    expect(noteTabOpened(state, "no-such-tab")).toBe(false);
  });

  it("on a desktop only Identity starts open; every block starts collapsed on a phone; a choice wins either way", () => {
    const state = fresh();
    expect(blockExpanded(state, "sidebar-identity", false)).toBe(true);
    expect(blockExpanded(state, "sidebar-actions", false)).toBe(false);
    expect(blockExpanded(state, "sidebar-milestones", false)).toBe(false);
    for (const id of ["sidebar-identity", "sidebar-milestones", "sidebar-actions"]) expect(blockExpanded(state, id, true)).toBe(false);
    state.blocks["sidebar-milestones"] = true;
    state.blocks["sidebar-identity"] = false;
    expect(blockExpanded(state, "sidebar-milestones", false)).toBe(true);
    expect(blockExpanded(state, "sidebar-identity", true)).toBe(false);
  });

  it("the choices round-trip through storage, and anything unreadable there is no choice at all", () => {
    const store = memory();
    writeSidebarState(store, { groups: { map: true }, blocks: { "sidebar-actions": false } });
    expect(readSidebarState(store)).toEqual({ groups: { map: true }, blocks: { "sidebar-actions": false } });
    expect(readSidebarState(memory({ [SIDEBAR_STORAGE_KEY]: "{not json" }))).toEqual(fresh());
    expect(readSidebarState(memory({ [SIDEBAR_STORAGE_KEY]: JSON.stringify({ groups: { map: "yes", comms: false }, blocks: [1] }) }))).toEqual({ groups: { comms: false }, blocks: {} });
    expect(readSidebarState(null)).toEqual(fresh());
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readSidebarState(throwing)).toEqual(fresh());
    expect(() => writeSidebarState(throwing, fresh())).not.toThrow();
  });
});

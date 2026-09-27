// AB#2481 (Board review item 12; DOCTRINE P-010, the audit in docs/design/p010-scroll-audit.md): every section of the
// left column collapses and expands, and stays as the player left it for the rest of the session, on every tab.
// - On a desktop, each navigation group's name is a toggle over its tabs. Until the player toggles a group, only the
//   group holding the open tab is expanded: six names and one group's tabs, where all seventeen tabs made the column
//   about 890px and put every tab at two screens or more. Opening a tab shows its group even if the player collapsed
//   it, so the open tab is never hidden by an earlier choice.
// - The sidebar's blocks (Corporation Identity, Milestones, Quick Actions). Milestones and Quick Actions start collapsed
//   on a desktop: Overview shows the same milestones, and every quick action is a tab the column already lists. On a
//   phone all three start collapsed (AB#1056).
// On a phone the groups are the bar along the bottom, and a group's button opens its tab as before: nothing here
// collapses a group there. Choices are kept in localStorage, validated on every read (as exchangeView.js keeps its
// view): they outlast the session the acceptance asks for, and session storage is off limits to client code (AB#757,
// tests/unit/noTokenStorage.test.js).
import { groupOf } from "./navGroups.js";

export const SIDEBAR_STORAGE_KEY = "isp.sidebar.v1";
/** The blocks that start collapsed on a desktop. */
const DESKTOP_COLLAPSED_BLOCKS = new Set(["sidebar-milestones", "sidebar-actions"]);

/** The player's choices so far: { groups: { id: expanded }, blocks: { id: expanded } }. Anything unreadable is none. */
export function readSidebarState(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(SIDEBAR_STORAGE_KEY) || "{}");
    const choices = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([, v]) => typeof v === "boolean"));
    return { groups: choices(saved.groups), blocks: choices(saved.blocks) };
  } catch {
    return { groups: {}, blocks: {} };
  }
}

export function writeSidebarState(storage, state) {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage blocked or full: the column still works, it just forgets on reload
  }
}

/** Whether a navigation group is expanded on a desktop: the player's choice, else only the open tab's group. */
export function groupExpanded(state, group, activeGroup) {
  return state.groups[group] ?? group === activeGroup;
}

/** Whether a sidebar block is expanded: the player's choice, else on a desktop only Corporation Identity, on a phone none. */
export function blockExpanded(state, id, narrow) {
  return state.blocks[id] ?? (!narrow && !DESKTOP_COLLAPSED_BLOCKS.has(id));
}

/** A tab was opened: its group shows again even if the player had collapsed it. Returns whether anything changed. */
export function noteTabOpened(state, tab) {
  const group = groupOf(tab);
  if (!group || state.groups[group] !== false) return false;
  delete state.groups[group];
  return true;
}

// ─── The page side ───────────────────────────────────────────────────────────────────────────────────────────────
const storage = (() => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
})();
const state = readSidebarState(storage);

const activeGroup = (root) => groupOf(root.querySelector(".nav-tab.active")?.dataset.tab);

/** Show each group collapsed or expanded; on a phone, none collapsed and no toggle state on the bar's buttons. */
export function applyNavGroups(narrow, root = document) {
  const active = activeGroup(root);
  root.querySelectorAll(".nav-group").forEach((section) => {
    const collapsed = !narrow && !groupExpanded(state, section.dataset.group, active);
    section.classList.toggle("is-collapsed", collapsed);
    const button = section.querySelector(".nav-group__button");
    if (!button) return;
    if (narrow) button.removeAttribute("aria-expanded");
    else button.setAttribute("aria-expanded", String(!collapsed));
  });
}

/** Show each sidebar block collapsed or expanded. */
export function applySidebarBlocks(narrow, root = document) {
  root.querySelectorAll(".side-panel__toggle").forEach((button) => {
    const content = root.getElementById(button.getAttribute("aria-controls") || "");
    if (!content) return;
    const open = blockExpanded(state, content.id, narrow);
    button.setAttribute("aria-expanded", String(open));
    content.hidden = !open;
  });
}

/** The player pressed a group's name on a desktop. */
export function toggleNavGroup(group, root = document) {
  const section = root.querySelector(`.nav-group[data-group="${group}"]`);
  if (!section) return;
  state.groups[group] = section.classList.contains("is-collapsed");
  writeSidebarState(storage, state);
  applyNavGroups(false, root);
}

/** The player pressed a sidebar block's toggle. */
export function toggleSidebarBlock(id, narrow, root = document) {
  state.blocks[id] = !blockExpanded(state, id, narrow);
  writeSidebarState(storage, state);
  applySidebarBlocks(narrow, root);
}

/** A tab was opened (app.js setTab): show its group, and collapse the group the player left unless they chose it. */
export function showTabGroup(tab, narrow, root = document) {
  if (noteTabOpened(state, tab)) writeSidebarState(storage, state);
  applyNavGroups(narrow, root);
}

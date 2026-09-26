// ISP-75 (AB#764): the navigation's six groups. Fourteen top-level tabs were too many for a bottom bar and for a first
// hour; each tab now lives in one group, and a group opens the tab it last showed (its first, until then). Travel is in
// Map and appears only in transit (app.js). tests/unit/navGroups.test.js reads index.html and fails if a panel is left
// out of a group or a group names a panel that is gone.
import { WALKTHROUGH_STEPS } from "./walkthrough.js";

export const NAV_GROUPS = [
  { id: "company", label: "Company", tabs: ["overview", "inbox", "finance", "ceo", "missions"] },
  { id: "station", label: "Station", tabs: ["station"] },
  { id: "industry", label: "Industry", tabs: ["rnd", "refinery", "logistics"] },
  { id: "market", label: "Market", tabs: ["market", "assets"] },
  { id: "comms", label: "Comms", tabs: ["chat", "forums"] },
  { id: "map", label: "Map", tabs: ["starmap", "travel"] }
];

/**
 * ISP-83 (AB#772): each tab's name as the navigation shows it. A milestone card said "Go to Rnd", "Go to Market" and
 * "Go to Missions" for Corporate R&D, the Galactic Exchange and Assignments, title-casing the panel's id; it names the
 * tab the player will look for now. tests/unit/navGroups.test.js holds these to the buttons in index.html.
 */
export const TAB_LABELS = {
  overview: "Overview", inbox: "Inbox", finance: "Financial Core", ceo: "CEO Insight", missions: "Assignments",
  station: "Station", rnd: "Corporate R&D", refinery: "Refinery Chains", logistics: "Logistics",
  market: "Galactic Exchange", assets: "Assets", chat: "Chat", forums: "Forums", starmap: "Starmap", travel: "Travel"
};

/** The id of the group a tab is in, or null. */
export function groupOf(tab) {
  return NAV_GROUPS.find((g) => g.tabs.includes(tab))?.id ?? null;
}

/**
 * Which groups the navigation shows. A new corporation (level 0) taking its first briefing sees a group once a step
 * has reached it, Company from the start, so the first hour is not fourteen choices at once; anyone else, and anyone
 * once the briefing is closed, sees all six. Replay Onboarding on an established corporation shows all six too.
 */
export function revealedGroups({ walkthroughOpen, level, stepIndex }) {
  const all = NAV_GROUPS.map((g) => g.id);
  if (!walkthroughOpen || Number(level) > 0) return all;
  const reached = new Set(["company"]);
  WALKTHROUGH_STEPS.slice(0, Math.max(0, stepIndex) + 1).forEach((s) => reached.add(groupOf(s.tab)));
  return all.filter((id) => reached.has(id));
}

// ─── The page side ───────────────────────────────────────────────────────────────────────────────────────────────
const lastTab = new Map(); // group id -> the tab it last showed, so a group reopens where the player left it

/** Mark the group that holds `tab` open, and remember `tab` as the one that group shows. */
export function openGroupOf(tab, root = document) {
  const group = groupOf(tab);
  if (!group) return;
  lastTab.set(group, tab);
  root.querySelectorAll(".nav-group").forEach((section) => {
    const open = section.dataset.group === group;
    section.classList.toggle("is-open", open);
    section.querySelector(".nav-group__button")?.classList.toggle("active", open);
  });
}

/** The tab a group's button opens: the one it last showed if it can still be shown, else its first that can. */
export function tabForGroup(group, root = document) {
  const usable = (tab) => {
    const btn = root.querySelector(`.nav-tab[data-tab="${tab}"]`);
    return btn && !btn.hidden && !btn.disabled;
  };
  const remembered = lastTab.get(group);
  if (remembered && usable(remembered)) return remembered;
  return NAV_GROUPS.find((g) => g.id === group)?.tabs.find(usable) ?? null;
}

/** Show only these groups; the rest are hidden until revealedGroups includes them. */
export function showOnlyGroups(ids, root = document) {
  const shown = new Set(ids);
  root.querySelectorAll(".nav-group").forEach((section) => {
    section.hidden = !shown.has(section.dataset.group);
  });
}

/** A group whose every visible tab is locked (in transit) is locked too, so the bar never offers a dead end. */
export function lockEmptyGroups(root = document) {
  root.querySelectorAll(".nav-group").forEach((section) => {
    const tabs = [...section.querySelectorAll(".nav-tab")].filter((t) => !t.hidden);
    const button = section.querySelector(".nav-group__button");
    if (button) button.disabled = tabs.length > 0 && tabs.every((t) => t.disabled);
  });
}

/** A count on a group's button, for what a closed group is holding (Bug #1130: unread mail, seen from anywhere). */
export function setGroupCount(group, count, root = document) {
  const button = root.querySelector(`.nav-group__button[data-group="${group}"]`);
  if (!button) return;
  const label = NAV_GROUPS.find((g) => g.id === group)?.label ?? group;
  button.textContent = label;
  button.removeAttribute("aria-label");
  if (count > 0) {
    // A badge, not "(n)" in the words: on a phone the bar gives each group about 62px, and the name must fit.
    const badge = document.createElement("span");
    badge.className = "nav-count";
    badge.dataset.count = String(count); // drawn by CSS on a desktop; a dot on a phone
    button.append(badge);
    button.setAttribute("aria-label", `${label} (${count})`);
  }
}

// ISP-200 (AB#894): the Conglomerate Affairs Bureau's view: file a charter (confirm first, as ISP-19 asks of anything
// that costs), browse the directory and apply, answer invitations, and for a member its conglomerate: roster, roles,
// removal, the founder's transfer, emblem and colour, succession, leaving and dissolution. The HTML is
// conglomerateBureau.js; this file fetches and binds. The server decides everything; this only asks and redraws.
//
// ISP-201 (AB#895): the same view, bindings and state draw the Company group's Conglomerate tab (the headquarters:
// the member view anywhere, and for an independent corporation its invitations, the directory and the way to the
// Bureau). The last read is kept on appState.conglomerate, which the Overview's card reads.
//
// ISP-206 (AB#901): a member's tab has its own tabs, Roster, Treasury and Hangar. The Treasury and Hangar screens
// (conglomerateTreasury.js) read GET .../treasury and .../hangar, a ledger page at a time, and move money and goods.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { charterHtml, directoryHtml, hqHtml, invitationsHtml, memberHtml } from "../conglomerateBureau.js";
import { hangarHtml, hqTabsHtml, treasuryHtml } from "../conglomerateTreasury.js";
import { deepClone } from "../helpers.js";
import { appState } from "../state.js";
import { setTab, showTradeConfirmation, updateAllViews } from "./shared.js";
import { showActionReceipt } from "./receiptModal.js"; // ISP-203 (AB#897): the level-up overlay
import { showStationBuilding } from "./station.js";
import { scrollBehavior } from "../motion.js"; // AB#1760

const CHARTER_STATION = "earth-station-prime";
// The view's own state survives a redraw: the last reads, the charter form, and the invite search.
const bureau = {
  accountId: null, view: null, directory: null, error: null, loading: null, form: {}, search: null, target: null, mode: "bureau",
  // ISP-206 (AB#901): the Conglomerate tab's own tab, the treasury and hangar reads, the ledger pages and each form's line
  hqTab: "roster", treasury: null, hangar: null, pages: { treasury: 0, hangar: 0 }, money: { treasury: {}, hangar: {} }
};
const listeners = new Set();
const bound = new WeakSet();
const json = { "Content-Type": "application/json" };
const acct = () => `/api/accounts/${encodeURIComponent(appState.accountId)}`;
const cong = (id) => `${acct()}/conglomerates/${encodeURIComponent(id)}`;

/** The element the view is drawn in now (the Bureau's building panel, or the Conglomerate tab), while it is on the page. */
function panel() {
  const el = bureau.target;
  return el?.isConnected && el.querySelector('[data-role="cong-body"]') ? el : null;
}

/** Hear each fresh read of the corporation's conglomerate (the Overview's card). */
export function onConglomerateChange(listener) {
  listeners.add(listener);
}

function redraw() {
  const el = panel();
  if (!el) return; // the player has left the Bureau
  const corp = appState.data?.corp || {};
  const view = bureau.view ? { ...bureau.view, me: corp.publicId, atBureau: corp.currentStationId === CHARTER_STATION } : null;
  if (bureau.mode === "hq") {
    const roster = hqHtml(view, bureau.directory, { search: bureau.search, error: bureau.error });
    if (!view?.conglomerate) { el.querySelector('[data-role="cong-body"]').innerHTML = roster; return; }
    const may = view.conglomerate.permissions;
    const stationId = bureau.hangar?.stationId;
    el.querySelector('[data-role="cong-body"]').innerHTML = hqTabsHtml(bureau.hqTab, {
      roster,
      treasury: treasuryHtml(bureau.treasury && { ...bureau.treasury, me: corp.publicId }, { may, status: bureau.money.treasury }),
      hangar: hangarHtml(bureau.hangar, { may, status: bureau.money.hangar, own: stationId ? corp.inventory?.[stationId] || {} : {}, docked: corp.currentStationId === stationId })
    });
    return;
  }
  el.querySelector('[data-role="cong-body"]').innerHTML = view
    ? memberHtml(view, { search: bureau.search }) + invitationsHtml(view) + charterHtml(view, bureau.form) + directoryHtml(bureau.directory, view, { error: bureau.error })
    : bureau.error ? directoryHtml(null, null, { error: bureau.error }) : `<p class="station__note">Opening the Bureau's register…</p>`;
}

/** Read the corporation's conglomerate and the directory, then redraw whichever view is open. One read at a time. */
export function loadConglomerate() {
  if (bureau.accountId !== appState.accountId) Object.assign(bureau, { accountId: appState.accountId, view: null, directory: null, error: null, form: {}, search: null });
  bureau.loading ??= load().finally(() => { bureau.loading = null; });
  return bureau.loading;
}

async function load() {
  try {
    const [view, directory] = await Promise.all([
      parseJsonResponse(await apiFetch(`${acct()}/conglomerate`)),
      parseJsonResponse(await apiFetch("/api/conglomerates"))
    ]);
    Object.assign(bureau, { view, directory: directory.conglomerates, error: null });
    appState.conglomerate = view.conglomerate ? { ...view.conglomerate } : null;
    if (view.conglomerate && bureau.mode === "hq") await loadMoney();
  } catch (error) {
    bureau.error = error?.message || "The Bureau did not answer.";
  }
  redraw();
  for (const listener of listeners) listener(appState.conglomerate);
  showLevelReached();
}

/**
 * ISP-203 (AB#897): a level reached since this member last saw it: the milestone overlay once, then the server is told,
 * so a reload or another device does not show it again. Every member reads the view on the room's levelled event.
 */
let levelShown = null;
function showLevelReached() {
  const c = bureau.view?.conglomerate;
  const level = c?.levelReached;
  if (!level || levelShown === `${c.id}:${level}`) return;
  levelShown = `${c.id}:${level}`;
  const next = c.levels?.next ? { level: c.levels.next.level, maxMembers: c.levels.next.maxMembers } : null;
  showActionReceipt({ conglomerateLevel: { name: c.name, level, maxMembers: c.maxMembers, next } });
  apiFetch(`${cong(c.id)}/level-seen`, { method: "POST", headers: json, body: JSON.stringify({ level }) }).catch(() => { levelShown = null; });
}

/** ISP-206 (AB#901): read the treasury and the hangar, each at its ledger page, or only `which`. */
async function loadMoney(which) {
  const id = bureau.view?.conglomerate?.id;
  if (!id) return;
  const read = async (kind) => {
    try {
      bureau[kind] = await parseJsonResponse(await apiFetch(`${cong(id)}/${kind}?offset=${bureau.pages[kind]}&limit=25`));
    } catch (error) {
      bureau[kind] = { error: error?.message || "The Bureau did not answer." };
    }
  };
  await Promise.all((which ? [which] : ["treasury", "hangar"]).map(read));
}

/** Parse a typed amount: digits, with or without thousands commas; anything else is null. */
const typedWhole = (value) => (/^\s*\d{1,3}(,?\d{3})*\s*$|^\s*\d+\s*$/.test(String(value)) ? Number(String(value).replace(/[\s,]/g, "")) : null);

/** Move money or goods: ask, reload the register and the ledgers, then say what happened on the form's own line. */
async function moveMoney(kind, op, body, { confirm, done } = {}) {
  const key = op === "withdrawal-block" ? "withdraw" : op;
  bureau.money[kind] = {};
  if (confirm && !(await showTradeConfirmation(confirm))) return;
  const path = op === "withdrawal-block" ? `treasury/withdrawals/${encodeURIComponent(body.id)}/block` : `${kind}/${op}`;
  try {
    const answer = await parseJsonResponse(await apiFetch(`${cong(bureau.view.conglomerate.id)}/${path}`, { method: "POST", headers: json, body: JSON.stringify(body) }));
    bureau.money[kind] = { [key]: { text: done ? done(answer) : "Done.", ok: true } };
    bureau.pages[kind] = 0; // the new row is the newest
    await refreshAccount();
  } catch (error) {
    bureau.money[kind] = { [key]: { text: error?.message || "The Bureau refused that." } };
  }
  await loadConglomerate();
}

/** Run one Bureau request; on success reload the register (and the account, when it changed), on refusal say why. */
async function act(url, { body, status, confirm, account = false } = {}) {
  if (confirm && !(await showTradeConfirmation(confirm))) return;
  try {
    const answer = await parseJsonResponse(await apiFetch(url, { method: "POST", headers: json, body: JSON.stringify(body || {}) }));
    if (account && answer?.state) {
      appState.data = deepClone(answer.state);
      updateAllViews();
    }
    await loadConglomerate();
    return answer;
  } catch (error) {
    const line = panel()?.querySelector(`[data-role="${status}"]`);
    if (line) line.textContent = error?.message || "The Bureau refused that.";
    else console.warn("[bureau]", error?.message);
    return null;
  }
}

const memberName = (corp) => bureau.view?.conglomerate?.members.find((m) => m.corp === corp)?.corpName || "that corporation";

async function fileCharter(form) {
  const status = form.querySelector('[data-role="cong-charter-status"]');
  bureau.form = { name: form.name.value.trim(), emblem: Number(form.emblem?.value) || 1, colour: Number(form.colour?.value) || 1 };
  if (!bureau.form.name) { status.textContent = "Give the conglomerate a name."; form.name.focus(); return; }
  const c = bureau.view.charter;
  const answer = await act(`${acct()}/conglomerates`, {
    body: bureau.form,
    status: "cong-charter-status",
    account: true,
    confirm: {
      heading: "Conglomerate Affairs Bureau",
      title: `File the charter for ${bureau.form.name}?`,
      confirmLabel: `Pay ${(c.fee + c.deposit).toLocaleString("en-US")} credits and file`,
      rows: [
        { label: "Charter fee", value: `${c.fee.toLocaleString("en-US")} credits, to the ISA` },
        { label: "Treasury deposit", value: `${c.deposit.toLocaleString("en-US")} credits, into the new treasury` },
        { label: "The name", value: "Never changes once filed" }
      ]
    }
  });
  if (answer) bureau.form = {};
}

async function searchCorporations(form) {
  const name = form.name.value.trim();
  bureau.search = { name, results: null, status: "" };
  if (!name) { bureau.search.status = "Type part of a corporation's name."; redraw(); return; }
  try {
    const found = await parseJsonResponse(await apiFetch(`${acct()}/corporations?name=${encodeURIComponent(name)}`));
    const members = new Set((bureau.view?.conglomerate?.members || []).map((m) => m.corp));
    bureau.search.results = found.corporations.filter((c) => !members.has(c.publicId));
  } catch (error) {
    bureau.search.status = error?.message || "The search did not answer.";
  }
  redraw();
  panel()?.querySelector("#cong-invite-name")?.focus();
}

/** Draw the Bureau into the station's building panel and bind it. `header` is the building's shared header markup. */
export function renderConglomerateBureau(contentEl, data, header) {
  Object.assign(bureau, { target: contentEl, mode: "bureau" });
  contentEl.innerHTML = `${header}<div class="cong-body" data-role="cong-body"></div>`;
  redraw();
  loadConglomerate();
  bind(contentEl); // the panel is reused by every building: bind once, and only to the Bureau's own controls
}

/** ISP-201 (AB#895): draw the Company group's Conglomerate tab into `container` and bind it. */
export function renderConglomerateHq(container) {
  if (!container) return;
  Object.assign(bureau, { target: container, mode: "hq" });
  if (!container.querySelector('[data-role="cong-body"]')) container.innerHTML = '<div class="cong-body" data-role="cong-body"></div>';
  redraw();
  loadConglomerate();
  bind(container);
}

/** Open the Bureau: its building on Earth Station Prime, from anywhere in the app. */
export function openBureau() {
  setTab("station");
  showStationBuilding("conglomerate-affairs-bureau");
}

function bind(contentEl) {
  if (bound.has(contentEl)) return;
  bound.add(contentEl);
  contentEl.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.closest?.('[data-role="cong-body"]')) return;
    event.preventDefault();
    if (form.matches('[data-role="cong-charter-form"]')) fileCharter(form);
    else if (form.matches('[data-role="cong-invite-search"]')) searchCorporations(form);
    else if (form.matches('[data-role="cong-treasury-deposit"]')) depositCredits(form);
    else if (form.matches('[data-role="cong-treasury-withdraw"]')) withdrawCredits(form);
    else if (form.matches('[data-role="cong-hangar-deposit"], [data-role="cong-hangar-withdraw"]')) moveGoods(form);
    else if (form.matches('[data-role="cong-identity-form"]')) {
      act(`${cong(bureau.view.conglomerate.id)}/identity`, { body: { emblem: Number(form.emblem.value), colour: Number(form.colour.value) }, status: "cong-roster-status" });
    }
  });
  contentEl.addEventListener("keydown", (event) => {
    const tab = event.target.closest?.('[data-role="cong-tab"]');
    if (!tab) return;
    const order = ["roster", "treasury", "hangar"];
    const i = order.indexOf(tab.dataset.tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: order.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(order[(next + order.length) % order.length]);
  });
  contentEl.addEventListener("change", (event) => {
    // The pickers draw each other: an emblem in the chosen colour, a colour on the chosen emblem.
    const form = event.target.closest?.('[data-role="cong-charter-form"]');
    if (!form || !["emblem", "colour"].includes(event.target.name)) return;
    bureau.form = { name: form.name.value, emblem: Number(form.emblem.value), colour: Number(form.colour.value) };
    redraw();
    panel()?.querySelector(`input[name="${event.target.name}"][value="${event.target.value}"]`)?.focus();
  });
  contentEl.addEventListener("click", (event) => {
    const b = event.target.closest("button[data-role]");
    if (!b || !b.closest('[data-role="cong-body"]') || b.disabled) return;
    const d = b.dataset;
    const mine = bureau.view?.conglomerate;
    const scrollTo = (id) => panel()?.querySelector(`#${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    switch (d.role) {
      case "cong-reload": bureau.error = null; redraw(); loadConglomerate(); break;
      case "cong-open-bureau": openBureau(); break;
      case "cong-tab": selectTab(d.tab); break;
      case "cong-ledger-page": bureau.pages[d.which] = Math.max(0, Number(d.offset) || 0); loadMoney(d.which).then(redraw); break;
      case "cong-withdrawal-block":
        moveMoney("treasury", "withdrawal-block", { id: d.withdrawal }, {
          confirm: { heading: "Conglomerate treasury", title: "Block this withdrawal?", confirmLabel: "Block it", rows: [{ label: "Then", value: "It is stopped once a second director blocks it too, or at once if you are the founder and a director made it." }] },
          done: (a) => (a.withdrawal.state === "blocked" ? "Blocked: the withdrawal will not be paid." : "Your block is recorded. A second director's block stops it.")
        });
        break;
      case "cong-goto-directory": scrollTo("cong-directory"); break;
      case "cong-goto-charter":
        // In the Conglomerate tab the charter is the Bureau's: go there, or, away from Earth Station Prime, to the reason.
        if (bureau.mode === "hq") { if (appState.data?.corp?.currentStationId === CHARTER_STATION) openBureau(); else scrollTo("cong-bureau-why"); break; }
        scrollTo("cong-charter"); panel()?.querySelector("#cong-name")?.focus(); break;
      case "cong-apply": act(`${cong(d.conglomerate)}/applications`, { status: "cong-charter-status" }); break;
      case "cong-invitation-accept": act(`${cong(d.conglomerate)}/invitations/${encodeURIComponent(d.invitation)}/accept`, { status: "cong-charter-status" }); break;
      case "cong-invitation-decline": act(`${cong(d.conglomerate)}/invitations/${encodeURIComponent(d.invitation)}/decline`, { status: "cong-charter-status" }); break;
      case "cong-application-withdraw": act(`${cong(d.conglomerate)}/applications/${encodeURIComponent(d.application)}/withdraw`, { status: "cong-charter-status" }); break;
      case "cong-application-accept": act(`${cong(mine.id)}/applications/${encodeURIComponent(d.application)}/accept`, { status: "cong-roster-status" }); break;
      case "cong-application-decline": act(`${cong(mine.id)}/applications/${encodeURIComponent(d.application)}/decline`, { status: "cong-roster-status" }); break;
      case "cong-invitation-withdraw": act(`${cong(mine.id)}/invitations/${encodeURIComponent(d.invitation)}/withdraw`, { status: "cong-roster-status" }); break;
      case "cong-invite":
        act(`${cong(mine.id)}/invitations`, { body: { corpId: d.corp }, status: "cong-invite-status" }).then((ok) => {
          if (ok) { bureau.search = { name: "", results: null, status: `Invitation sent to ${ok.invitation.corpName}.` }; redraw(); }
        });
        break;
      case "cong-promote": act(`${cong(mine.id)}/members/${encodeURIComponent(d.corp)}/role`, { body: { role: "director" }, status: "cong-roster-status" }); break;
      case "cong-demote": act(`${cong(mine.id)}/members/${encodeURIComponent(d.corp)}/role`, { body: { role: "member" }, status: "cong-roster-status" }); break;
      case "cong-remove":
        act(`${cong(mine.id)}/members/${encodeURIComponent(d.corp)}/remove`, {
          status: "cong-roster-status",
          confirm: { heading: "Conglomerate Affairs Bureau", title: `Remove ${memberName(d.corp)}?`, confirmLabel: "Remove", rows: [{ label: "What happens", value: "It leaves at once and cannot join any conglomerate for 24 hours. What it gave the treasury stays." }] }
        });
        break;
      case "cong-transfer":
        act(`${cong(mine.id)}/founder`, {
          body: { corpId: d.corp },
          status: "cong-roster-status",
          confirm: { heading: "Conglomerate Affairs Bureau", title: `Hand the founder role to ${memberName(d.corp)}?`, confirmLabel: "Hand it over", rows: [{ label: "You become", value: "A director. Only the new founder can hand it back." }] }
        });
        break;
      case "cong-leave":
        act(`${cong(mine.id)}/leave`, {
          status: "cong-roster-status",
          confirm: { heading: "Conglomerate Affairs Bureau", title: `Leave ${mine.name}?`, confirmLabel: "Leave", rows: [{ label: "Then", value: "Your corporation cannot join a conglomerate for 24 hours. What it gave the treasury stays." }] }
        });
        break;
      case "cong-dissolve": {
        const share = Math.floor((mine.treasury?.credits || 0) / Math.max(1, mine.memberCount));
        act(`${cong(mine.id)}/dissolve`, {
          status: "cong-roster-status",
          account: false,
          confirm: {
            heading: "Conglomerate Affairs Bureau",
            title: `Dissolve ${mine.name}?`,
            confirmLabel: "Dissolve it",
            rows: [
              { label: "Treasury", value: `${(mine.treasury?.credits || 0).toLocaleString("en-US")} credits, shared equally: about ${share.toLocaleString("en-US")} each to ${mine.memberCount} member${mine.memberCount === 1 ? "" : "s"}` },
              { label: "Members", value: "Free to join another conglomerate at once" },
              { label: "The name", value: "Reserved for 30 days, then free" }
            ]
          }
        }).then(() => refreshAccount());
        break;
      }
      case "cong-level-buy": { // ISP-203 (AB#897): the price before anything is paid
        const level = Number(d.level), cost = Number(d.cost), reserve = Number(d.reserve);
        const treasury = Math.floor(Number(mine.treasury?.credits) || 0);
        const next = mine.levels?.next;
        act(`${cong(mine.id)}/level`, {
          body: { level },
          status: "cong-level-status",
          confirm: {
            heading: "Conglomerate Affairs Bureau",
            title: `Buy level ${level} for ${mine.name}?`,
            confirmLabel: `Pay ${cost.toLocaleString("en-US")} credits`,
            rows: [
              { label: "From the treasury", value: `${cost.toLocaleString("en-US")} credits, leaving ${(treasury - cost).toLocaleString("en-US")}` },
              { label: "Kept for upkeep", value: `at least ${reserve.toLocaleString("en-US")} credits (the treasury keeps it; nothing is spent)` },
              { label: "Room", value: `${(next?.maxMembers ?? 0).toLocaleString("en-US")} members, from ${mine.maxMembers.toLocaleString("en-US")}` }
            ]
          }
        });
        break;
      }
      default: break;
    }
  });
}

/** ISP-206 (AB#901): select one of the Conglomerate tab's own tabs, and keep the choice across redraws. */
function selectTab(tab) {
  if (!["roster", "treasury", "hangar"].includes(tab)) return;
  bureau.hqTab = tab;
  redraw();
  panel()?.querySelector(`#cong-tab-${tab}`)?.focus();
}

async function depositCredits(form) {
  const amount = typedWhole(form.amount.value);
  if (!amount) { bureau.money.treasury = { deposit: { text: "Enter a whole number of credits, at least 1." } }; redraw(); return; }
  const t = bureau.treasury;
  const fee = Math.round((amount * (t?.custodyFeePct ?? 2)) / 100);
  await moveMoney("treasury", "deposit", { amount }, {
    confirm: {
      heading: "Conglomerate treasury",
      title: `Deposit ${amount.toLocaleString("en-US")} credits?`,
      confirmLabel: `Deposit ${amount.toLocaleString("en-US")} credits`,
      rows: [
        { label: "The treasury receives", value: `${(amount - fee).toLocaleString("en-US")} credits` },
        { label: "Custody fee", value: `${fee.toLocaleString("en-US")} credits, kept by the ISA` },
        { label: "Getting it back", value: "Only the founder and directors withdraw, within a daily cap" }
      ]
    },
    done: (a) => `Deposited ${a.deposited.toLocaleString("en-US")} credits; ${a.fee.toLocaleString("en-US")} went to the custody fee.`
  });
}

async function withdrawCredits(form) {
  const amount = typedWhole(form.amount.value);
  if (!amount) { bureau.money.treasury = { withdraw: { text: "Enter a whole number of credits, at least 1." } }; redraw(); return; }
  const t = bureau.treasury;
  const announced = t && amount > (t.balance * (t.noticePct ?? 10)) / 100;
  await moveMoney("treasury", "withdraw", { amount }, {
    confirm: announced ? {
      heading: "Conglomerate treasury",
      title: `Announce a withdrawal of ${amount.toLocaleString("en-US")} credits?`,
      confirmLabel: "Announce it",
      rows: [
        { label: "Why announced", value: `It is more than ${t.noticePct ?? 10}% of the balance` },
        { label: "Then", value: "Every member is told; it is paid in 24 hours unless two directors block it" }
      ]
    } : null,
    done: (a) => (a.withdrawal.state === "pending" ? `Announced. It is paid at ${new Date(a.withdrawal.completesAt).toISOString().slice(0, 16).replace("T", " ")} UTC unless blocked.` : `Withdrawn: ${a.withdrawal.amount.toLocaleString("en-US")} credits are in your corporation's account.`)
  });
}

async function moveGoods(form) {
  const op = form.matches('[data-role="cong-hangar-deposit"]') ? "deposit" : "withdraw";
  const quantity = typedWhole(form.quantity.value);
  if (!quantity) { bureau.money.hangar = { [op]: { text: "Enter a whole number of units, at least 1." } }; redraw(); return; }
  await moveMoney("hangar", op, { stationId: bureau.hangar?.stationId, item: form.item.value, quantity }, {
    done: (a) => (op === "deposit" ? `Deposited ${a.deposited.quantity.toLocaleString("en-US")} ${a.deposited.item}.` : `Withdrew ${a.withdrawn.quantity.toLocaleString("en-US")} ${a.withdrawn.item} into your stock.`)
  });
}

/** After a dissolution the treasury share is on the account: read it again so the header's credits move. */
async function refreshAccount() {
  try {
    const account = await parseJsonResponse(await apiFetch(acct()));
    if (account?.state) { appState.data = deepClone(account.state); updateAllViews(); }
  } catch { /* the Bureau already shows the outcome; the header catches up on its next update */ }
}

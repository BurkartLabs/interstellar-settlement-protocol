// ISP-200 (AB#894): the Conglomerate Affairs Bureau's view: file a charter (confirm first, as ISP-19 asks of anything
// that costs), browse the directory and apply, answer invitations, and for a member its conglomerate: roster, roles,
// removal, the founder's transfer, emblem and colour, succession, leaving and dissolution. The HTML is
// conglomerateBureau.js; this file fetches and binds. The server decides everything; this only asks and redraws.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { charterHtml, directoryHtml, invitationsHtml, memberHtml } from "../conglomerateBureau.js";
import { deepClone } from "../helpers.js";
import { appState } from "../state.js";
import { showTradeConfirmation, updateAllViews } from "./shared.js";
import { scrollBehavior } from "../motion.js"; // AB#1760

const CHARTER_STATION = "earth-station-prime";
// The view's own state survives a redraw: the last reads, the charter form, and the invite search.
const bureau = { accountId: null, view: null, directory: null, error: null, loading: false, form: {}, search: null };
const bound = new WeakSet();
const json = { "Content-Type": "application/json" };
const acct = () => `/api/accounts/${encodeURIComponent(appState.accountId)}`;
const cong = (id) => `${acct()}/conglomerates/${encodeURIComponent(id)}`;

function panel() {
  const el = document.getElementById("station-building-content");
  return el?.querySelector('[data-role="cong-body"]') ? el : null;
}

function redraw() {
  const el = panel();
  if (!el) return; // the player has left the Bureau
  const corp = appState.data?.corp || {};
  const view = bureau.view ? { ...bureau.view, me: corp.publicId, atBureau: corp.currentStationId === CHARTER_STATION } : null;
  el.querySelector('[data-role="cong-body"]').innerHTML = view
    ? memberHtml(view, { search: bureau.search }) + invitationsHtml(view) + charterHtml(view, bureau.form) + directoryHtml(bureau.directory, view, { error: bureau.error })
    : bureau.error ? directoryHtml(null, null, { error: bureau.error }) : `<p class="station__note">Opening the Bureau's register…</p>`;
}

async function load() {
  if (bureau.loading) return;
  bureau.loading = true;
  try {
    const [view, directory] = await Promise.all([
      parseJsonResponse(await apiFetch(`${acct()}/conglomerate`)),
      parseJsonResponse(await apiFetch("/api/conglomerates"))
    ]);
    Object.assign(bureau, { view, directory: directory.conglomerates, error: null });
  } catch (error) {
    bureau.error = error?.message || "The Bureau did not answer.";
  } finally {
    bureau.loading = false;
  }
  redraw();
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
    await load();
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
  if (bureau.accountId !== appState.accountId) Object.assign(bureau, { accountId: appState.accountId, view: null, directory: null, error: null, form: {}, search: null });
  contentEl.innerHTML = `${header}<div class="cong-body" data-role="cong-body"></div>`;
  redraw();
  load();
  if (bound.has(contentEl)) return;
  bound.add(contentEl); // the panel is reused by every building: bind once, and only to the Bureau's own controls
  contentEl.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.closest?.('[data-role="cong-body"]')) return;
    event.preventDefault();
    if (form.matches('[data-role="cong-charter-form"]')) fileCharter(form);
    else if (form.matches('[data-role="cong-invite-search"]')) searchCorporations(form);
    else if (form.matches('[data-role="cong-identity-form"]')) {
      act(`${cong(bureau.view.conglomerate.id)}/identity`, { body: { emblem: Number(form.emblem.value), colour: Number(form.colour.value) }, status: "cong-roster-status" });
    }
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
      case "cong-reload": bureau.error = null; redraw(); load(); break;
      case "cong-goto-directory": scrollTo("cong-directory"); break;
      case "cong-goto-charter": scrollTo("cong-charter"); panel()?.querySelector("#cong-name")?.focus(); break;
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
      default: break;
    }
  });
}

/** After a dissolution the treasury share is on the account: read it again so the header's credits move. */
async function refreshAccount() {
  try {
    const account = await parseJsonResponse(await apiFetch(acct()));
    if (account?.state) { appState.data = deepClone(account.state); updateAllViews(); }
  } catch { /* the Bureau already shows the outcome; the header catches up on its next update */ }
}

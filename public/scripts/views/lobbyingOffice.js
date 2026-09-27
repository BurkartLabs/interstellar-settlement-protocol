// ISP-240 (AB#935): the lobbying office at the Earth Assembly and at the Interplanetary Trade Commission. Reads the
// caller's office (GET /api/accounts/:id/lobbying), draws it (public/scripts/lobbyingOffice.js), and opens and pledges
// to campaigns after a confirmation that names the cost (ISP-19: anything that costs is confirmed first). The preview
// follows the form as it is typed. The server decides every campaign and pledge; a refusal shows in the status line.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone } from "../helpers.js";
import { FACTIONS, PARAMETER_LABELS, factionParameters, lobbyingOfficeHtml, previewText } from "../lobbyingOffice.js";
import { appState } from "../state.js";
import { pushFeedback, showTradeConfirmation, updateAllViews } from "./shared.js";

const office = { accountId: null, view: null, error: null, target: null, header: "", faction: null, forms: {} };
const acct = () => `/api/accounts/${encodeURIComponent(appState.accountId)}`;
const post = async (path, body) => parseJsonResponse(await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

/** The form for the faction shown: the first of its rules, the corporation's own system when it can be lobbied. */
function form() {
  const f = office.faction;
  if (!office.forms[f] && office.view) {
    const params = factionParameters(office.view, f);
    const here = office.view.systems.find((s) => s.id === office.view.currentSystemId) || office.view.systems[0];
    office.forms[f] = { parameter: params[0], systemId: here?.id, direction: "raise", credits: 0, standing: 0 };
  }
  return office.forms[f] || { parameter: null, systemId: null, direction: "raise", credits: 0, standing: 0 };
}

function draw() {
  const el = office.target;
  if (!el?.isConnected) return;
  el.innerHTML = `${office.header}${lobbyingOfficeHtml({ office: office.view, error: office.error, faction: office.faction, form: form() })}`;
}

async function load() {
  try {
    office.view = await parseJsonResponse(await apiFetch(`${acct()}/lobbying`));
    office.error = null;
  } catch (error) {
    office.error = error?.message || "The server did not answer.";
  }
  draw();
}

async function refreshAccount() {
  try {
    const account = await parseJsonResponse(await apiFetch(acct()));
    if (account?.state) { appState.data = deepClone(account.state); updateAllViews(); }
  } catch { /* the office shows the outcome; the header catches up on its next update */ }
}

const status = (text) => { const s = office.target?.querySelector('[data-role="lobby-status"]'); if (s) s.textContent = text; };
const systemName = (id) => office.view?.systems.find((s) => s.id === id)?.name || id;

async function openCampaign(f) {
  const credits = Math.max(0, Math.floor(Number(f.credits) || 0)), standing = Math.max(0, Number(f.standing) || 0);
  const t = office.view.terms;
  const ok = await showTradeConfirmation({
    heading: FACTIONS[office.faction].name,
    title: `${f.direction === "raise" ? "Raise" : "Lower"} the ${PARAMETER_LABELS[f.parameter].name.toLowerCase()} in ${systemName(f.systemId)}?`,
    confirmLabel: "Open campaign",
    rows: [
      { label: "Opening", value: `${t.openStandingCost} standing` },
      ...(credits ? [{ label: "Your pledge", value: `${credits.toLocaleString("en-US")} credits` }] : []),
      ...(standing ? [{ label: "Standing pledged", value: `${standing}` }] : []),
      { note: previewText(office.view, f) },
      { note: "Pledges are final and are paid to the faction, whatever the outcome." }
    ]
  });
  if (!ok) return;
  try {
    const opened = await post(`${acct()}/lobbying`, { parameter: f.parameter, systemId: f.systemId, direction: f.direction });
    if (credits || standing) await post(`${acct()}/lobbying/${encodeURIComponent(opened.campaign.id)}/pledges`, { side: "for", ...(credits ? { credits } : {}), ...(standing ? { standing } : {}) });
    pushFeedback(`Campaign opened in ${systemName(f.systemId)}: pledges close in ${t.pledgeHours} hours.`, "ok");
    office.forms[office.faction] = { ...f, credits: 0, standing: 0 };
    await Promise.all([load(), refreshAccount()]);
  } catch (error) {
    status(error?.message || "The campaign was not opened.");
    await load();
  }
}

async function pledgeTo(formEl) {
  const id = formEl.dataset.campaignId;
  const side = formEl.elements.side.value;
  const credits = Math.max(0, Math.floor(Number(formEl.elements.credits.value) || 0)), standing = Math.max(0, Number(formEl.elements.standing.value) || 0);
  const c = office.view.campaigns.find((x) => x.id === id);
  if (!c) return;
  const ok = await showTradeConfirmation({
    heading: FACTIONS[office.faction].name,
    title: `Pledge ${side === "for" ? "for" : "against"} the campaign in ${c.systemName}?`,
    confirmLabel: "Pledge",
    rows: [
      ...(credits ? [{ label: "Credits", value: credits.toLocaleString("en-US") }] : []),
      ...(standing ? [{ label: "Standing", value: `${standing}` }] : []),
      { note: "Pledges are final and are paid to the faction, whatever the outcome. The other side's amounts are not published." }
    ]
  });
  if (!ok) return;
  try {
    await post(`${acct()}/lobbying/${encodeURIComponent(id)}/pledges`, { side, ...(credits ? { credits } : {}), ...(standing ? { standing } : {}) });
    pushFeedback(`Pledged ${side} the campaign in ${c.systemName}.`, "ok");
    await Promise.all([load(), refreshAccount()]);
  } catch (error) {
    pushFeedback(error?.message || "The pledge was refused.", "warn");
  }
}

/** Draw the office for `faction` into the building panel `el`, under `header`. */
export function renderLobbyingOffice(el, faction, header) {
  if (office.accountId !== appState.accountId) Object.assign(office, { accountId: appState.accountId, view: null, error: null, forms: {} });
  office.target = el;
  office.header = header;
  office.faction = faction;
  draw();
  if (!el.dataset.lobbyBound) {
    el.dataset.lobbyBound = "1";
    el.addEventListener("change", (event) => {
      if (office.target !== el) return;
      const f = form();
      if (event.target.matches('[data-role="lobby-system"]')) { f.systemId = event.target.value; draw(); return; }
      const openForm = event.target.closest('[data-form="lobby-open"]');
      if (openForm && event.target.name && ["parameter", "systemId", "direction"].includes(event.target.name)) { f[event.target.name] = event.target.value; draw(); }
    });
    el.addEventListener("input", (event) => {
      if (office.target !== el) return;
      const openForm = event.target.closest('[data-form="lobby-open"]');
      if (!openForm || !["credits", "standing"].includes(event.target.name)) return;
      form()[event.target.name] = event.target.value;
      const p = openForm.querySelector('[data-role="lobby-preview"]');
      if (p) p.textContent = previewText(office.view, form()); // the preview follows the typing; no redraw, so focus stays
    });
    el.addEventListener("submit", (event) => {
      if (office.target !== el) return;
      const formEl = event.target;
      if (formEl.matches('[data-form="lobby-open"]')) { event.preventDefault(); openCampaign({ ...form() }); }
      else if (formEl.matches('[data-form="lobby-pledge"]')) { event.preventDefault(); pledgeTo(formEl); }
    });
  }
  load();
}

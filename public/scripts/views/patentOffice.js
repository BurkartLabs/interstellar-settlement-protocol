// ISP-237 (AB#932): Corporate Registry & Charters' patent office: read the caller's office (GET
// /api/accounts/:id/patents) and the public register (GET /api/patents), draw them (public/scripts/patentOffice.js), and
// file a patent after a confirmation that shows its fee (ISP-19: anything that costs is confirmed first). The server
// decides every filing; a refusal is shown in the section's status line. The register is kept on appState.patents,
// which the Refinery reads to show a royalty before a run starts.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { chainTitle } from "../chainPlan.js";
import { deepClone } from "../helpers.js";
import { patentOfficeHtml } from "../patentOffice.js";
import { basePricesOf } from "../patentRoyalty.js";
import { appState, techTree } from "../state.js";
import { pushFeedback, showTradeConfirmation, updateAllViews } from "./shared.js";

const office = { accountId: null, view: null, error: null, target: null, header: "" };
const acct = () => `/api/accounts/${encodeURIComponent(appState.accountId)}`;

/** The public register, kept on appState.patents for the Refinery's confirmation. Silent on failure. */
export async function loadPatentRegister() {
  try {
    appState.patents = (await parseJsonResponse(await apiFetch("/api/patents"))).patents || [];
  } catch { /* the server still charges the royalty at settlement, and its receipt names it */ }
  return appState.patents || [];
}

/** How the page names a subject: a research node's name, or a chain's title from the world's chain list. */
function context() {
  const chains = appState.data?.world?.refineryChains || [];
  return {
    now: Date.now(),
    chains,
    basePrices: basePricesOf(appState.data?.market?.npcBuyOrders),
    researchCost: (id) => techTree.find((t) => t.id === id)?.costCredits,
    nameOf: (kind, id) => (kind === "research" ? techTree.find((t) => t.id === id)?.name : (() => { const c = chains.find((x) => x.id === id); return c ? chainTitle(c) : null; })())
  };
}

function draw() {
  const el = office.target;
  if (!el?.isConnected) return;
  el.innerHTML = `${office.header}${patentOfficeHtml({ office: office.view, register: appState.patents, error: office.error }, context())}`;
}

async function load() {
  try {
    const [view] = await Promise.all([parseJsonResponse(await apiFetch(`${acct()}/patents`)), loadPatentRegister()]);
    office.view = view;
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
  } catch { /* the office already shows the outcome; the header catches up on its next update */ }
}

async function file(button) {
  const kind = button.dataset.kind, subjectId = button.dataset.subjectId;
  const ratePct = Number(document.getElementById(button.dataset.rateInput)?.value);
  const f = office.view?.filable.find((x) => x.kind === kind && x.subjectId === subjectId);
  if (!f || !Number.isInteger(ratePct)) return;
  const name = context().nameOf(kind, subjectId) || f.subjectName;
  const t = office.view.terms;
  const ok = await showTradeConfirmation({
    heading: "Corporate Registry & Charters",
    title: `File a patent on ${name}?`,
    confirmLabel: `File patent (${t.filingFee.toLocaleString("en-US")} credits)`,
    rows: [
      { label: "Filing fee", value: `${t.filingFee.toLocaleString("en-US")} credits, paid to the ISA` },
      { label: "Royalty", value: `${ratePct}% ${kind === "research" ? "of the node's research cost" : "of each run's output at the standing bid"}, paid by every corporation but yours` },
      { label: "Term", value: `${t.termDays} days from today, never renewed` }
    ]
  });
  if (!ok) return;
  const status = office.target?.querySelector('[data-role="patent-status"]');
  button.disabled = true;
  try {
    const res = await parseJsonResponse(await apiFetch(`${acct()}/patents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, subjectId, ratePct }) }));
    pushFeedback(`Patent filed on ${name} at ${res.patent.ratePct}%, in force until ${new Date(res.patent.endsAt).toISOString().slice(0, 10)}.`, "ok");
    await Promise.all([load(), refreshAccount()]);
  } catch (error) {
    button.disabled = false;
    if (status) status.textContent = error?.message || "The Registry refused the filing.";
  }
}

/** Draw the office into the building panel `el`, under `header` (the building's name, where docked and description). */
export function renderPatentOffice(el, header) {
  if (office.accountId !== appState.accountId) Object.assign(office, { accountId: appState.accountId, view: null, error: null });
  office.target = el;
  office.header = header;
  draw();
  if (!el.dataset.patentBound) {
    el.dataset.patentBound = "1";
    el.addEventListener("click", (event) => {
      const button = event.target.closest('[data-role="patent-file"]');
      if (button && el.contains(button) && office.target === el) file(button);
    });
  }
  load();
}

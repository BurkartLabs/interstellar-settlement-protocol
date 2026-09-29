// ISP-243 (AB#939): the Galactic Arbitration Council's chambers. Reads the caller's cases (GET
// /api/accounts/:id/arbitration/cases) and the public docket (GET /api/arbitration/docket); for filing, the records the
// caller may file a claim type on (GET .../arbitration/records/:type) and the evidence preview (POST
// .../arbitration/preview), then files after a confirmation that shows the fee (ISP-19); a respondent cures from its
// case. The HTML is public/scripts/arbitrationCouncil.js. The server decides everything; this only asks and redraws.

import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { chainTitle } from "../chainPlan.js";
import { deepClone } from "../helpers.js";
import { CLAIMS, chambersHtml } from "../arbitrationCouncil.js";
import { appState, techTree } from "../state.js";
import { formatSystemLabel, pushFeedback, showTradeConfirmation, updateAllViews } from "./shared.js";
import { refusalMeaning } from "../protocol.js"; // ISP-255d (AB#4826)

/** ISP-255d (AB#4826): the Council refuses for want of credits with its own code, cannot-pay; any other refusal is Denied. */
const councilRefusal = (error) => (error?.code === "cannot-pay" ? "unfunded" : refusalMeaning(error));
const onCouncil = (meaning) => ({ meaning, screen: "building-galactic-arbitration-council" });

const json = { "Content-Type": "application/json" };
const chambers = { accountId: null, target: null, header: "", cases: null, docket: null, error: null, open: null, state: { type: null, records: null, recordId: null, preview: null, previewError: null, status: "" } };
const acct = () => `/api/accounts/${encodeURIComponent(appState.accountId)}`;

function context() {
  const corp = appState.data?.corp || {};
  const chains = appState.data?.world?.refineryChains || [];
  return {
    now: Date.now(),
    open: chambers.open,
    stationName: (id) => (appState.stationRegistry || []).find((s) => s.id === id)?.name || id,
    systemName: (id) => formatSystemLabel(id),
    subjectName: (id) => techTree.find((t) => t.id === id)?.name || (() => { const c = chains.find((x) => x.id === id); return c ? chainTitle(c) : null; })(),
    isMe: (party) => (party?.type === "corp" && party.id === corp.publicId) || (party?.type === "conglomerate" && party.id === (corp.conglomerateId || appState.conglomerate?.conglomerate?.id))
  };
}

function draw() {
  const el = chambers.target;
  if (!el?.isConnected) return;
  // keep which case is open across a redraw
  const openCase = el.querySelector("[data-gac-case] details[open]")?.closest("[data-gac-case]")?.getAttribute("data-gac-case");
  if (openCase) chambers.open = openCase;
  el.innerHTML = `${chambers.header}${chambersHtml(chambers, context())}`;
}

async function loadRegistry() {
  try {
    const [mine, docket] = await Promise.all([parseJsonResponse(await apiFetch(`${acct()}/arbitration/cases`)), parseJsonResponse(await apiFetch("/api/arbitration/docket"))]);
    chambers.cases = mine.cases || [];
    chambers.docket = docket.cases || [];
    chambers.error = null;
  } catch (error) {
    chambers.error = error?.message || "The server did not answer.";
  }
  draw();
}

async function chooseType(type) {
  Object.assign(chambers.state, { type, records: null, recordId: null, preview: null, previewError: null, status: "" });
  draw();
  try {
    chambers.state.records = (await parseJsonResponse(await apiFetch(`${acct()}/arbitration/records/${encodeURIComponent(type)}`))).records || [];
  } catch (error) {
    chambers.state.records = [];
    chambers.state.status = error?.message || "Your records could not be read.";
    chambers.state.statusMeaning = "failed"; // ISP-255d (AB#4826)
  }
  if (chambers.state.type === type) draw();
}

async function chooseRecord(recordId) {
  const { type } = chambers.state;
  Object.assign(chambers.state, { recordId, preview: null, previewError: null, status: "" });
  draw();
  try {
    const res = await parseJsonResponse(await apiFetch(`${acct()}/arbitration/preview`, { method: "POST", headers: json, body: JSON.stringify({ type, recordId }) }));
    if (chambers.state.recordId === recordId) chambers.state.preview = res.preview;
  } catch (error) {
    if (chambers.state.recordId === recordId) chambers.state.previewError = error?.message || "The evidence could not be read.";
  }
  draw();
  chambers.target?.querySelector('[data-gac-step="preview"]')?.scrollIntoView?.({ block: "nearest" });
}

async function refreshAccount() {
  try {
    const account = await parseJsonResponse(await apiFetch(acct()));
    if (account?.state) { appState.data = deepClone(account.state); updateAllViews(); }
  } catch { /* the chambers already show the outcome */ }
}

async function file() {
  const p = chambers.state.preview;
  if (!p) return;
  const title = CLAIMS.find((c) => c.id === p.type)?.title || p.type;
  const ok = await showTradeConfirmation({
    heading: "Galactic Arbitration Council",
    title: `File a ${title.toLowerCase()} case against ${p.respondent.name}?`,
    confirmLabel: `File case (${p.fee.toLocaleString("en-US")} credits)`,
    rows: [
      { label: "Filing fee", value: `${p.fee.toLocaleString("en-US")} credits, held until the ruling` },
      { label: "Amount claimed", value: `${p.amountClaimed.toLocaleString("en-US")} credits on this evidence` },
      { label: "Response window", value: `${p.responseHours} hours for ${p.respondent.name} to cure` }
    ]
  });
  if (!ok) return;
  const button = chambers.target?.querySelector('[data-role="gac-file"]');
  if (button) button.disabled = true;
  try {
    const res = await parseJsonResponse(await apiFetch(`${acct()}/arbitration/cases`, { method: "POST", headers: json, body: JSON.stringify({ type: p.type, recordId: chambers.state.recordId }) }));
    pushFeedback(`${res.case.ref}: case filed against ${res.case.respondent.name}.`, "ok", onCouncil("pending"));
    chambers.open = res.case.ref;
    Object.assign(chambers.state, { type: null, records: null, recordId: null, preview: null, previewError: null, status: `${res.case.ref} is filed. The respondent has been notified.`, statusMeaning: "pending" });
    await Promise.all([loadRegistry(), refreshAccount()]);
  } catch (error) {
    if (button) button.disabled = false;
    chambers.state.status = error?.message || "The Council refused the filing.";
    chambers.state.statusMeaning = councilRefusal(error);
    draw();
  }
}

async function cure(ref) {
  const c = (chambers.cases || []).find((x) => x.ref === ref);
  if (!c) return;
  const ok = await showTradeConfirmation({
    heading: "Galactic Arbitration Council",
    title: `Cure ${ref}?`,
    confirmLabel: `Cure (${c.amountClaimed.toLocaleString("en-US")} credits)`,
    rows: [
      { label: "You pay", value: `${c.amountClaimed.toLocaleString("en-US")} credits to ${c.claimant.name}, now` },
      { label: "The case", value: "Closed as cured: no ruling is applied, and no Council debt is recorded" }
    ]
  });
  if (!ok) return;
  try {
    await parseJsonResponse(await apiFetch(`${acct()}/arbitration/cases/${encodeURIComponent(ref)}/cure`, { method: "POST", headers: json, body: "{}" }));
    pushFeedback(`${ref}: cured.`, "ok", onCouncil("complete"));
    await Promise.all([loadRegistry(), refreshAccount()]);
  } catch (error) {
    pushFeedback(error?.message || "The cure was refused.", "warn", onCouncil(councilRefusal(error)));
  }
}

/** Draw the chambers into the building panel `el`, under `header`. */
export function renderArbitrationCouncil(el, header) {
  if (chambers.accountId !== appState.accountId) {
    Object.assign(chambers, { accountId: appState.accountId, cases: null, docket: null, error: null, open: null, state: { type: null, records: null, recordId: null, preview: null, previewError: null, status: "" } });
  }
  chambers.target = el;
  chambers.header = header;
  draw();
  if (!el.dataset.gacBound) {
    el.dataset.gacBound = "1";
    el.addEventListener("change", (event) => {
      if (chambers.target !== el) return;
      const input = event.target;
      if (input.matches?.('[data-role="gac-type"]')) chooseType(input.value);
      else if (input.matches?.('[data-role="gac-record"]')) chooseRecord(input.value);
    });
    el.addEventListener("click", (event) => {
      if (chambers.target !== el) return;
      if (event.target.closest('[data-role="gac-file"]')) file();
      const cureBtn = event.target.closest('[data-role="gac-cure"]');
      if (cureBtn) cure(cureBtn.dataset.ref);
    });
  }
  loadRegistry();
}

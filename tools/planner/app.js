// The Economy Planner's interface (AB#4911). Plain DOM, inline SVG, no dependencies: it runs offline against the
// local server (scripts/planner.mjs). The simulation lives in ./engine.js; this file edits a plan and draws the result.
import { simulate, priceAction, newAction, newDay, newPhase, cloneDay, flattenDays, defaultName, boardSheetPlan, KINDS, HOURS, newId } from "./engine.js";

const STORE = "isp.planner.plans";
const UIKEY = "isp.planner.ui";
const MAX_UNDO = 50;
const KIND_LABEL = { custom: "Custom", office: "Office", hire: "Hire", lease: "Lease", yard: "Yard", cycle: "Cycle", research: "Research" };
const KIND_MENU = { custom: "Custom income / expense", office: "Office lease", hire: "Hire staff", lease: "Mining lease", yard: "Extractor yard", cycle: "Mining cycle", research: "Research" };
const CATS = ["office", "staff", "leases", "buildings", "mining", "research", "travel", "other"];
const INCOME_CATS = ["sales", "income"];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => { const v = Math.round(n || 0); return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US"); };
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtK = (v) => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : a >= 1000 ? Math.round(a / 1000) + "k" : String(Math.round(a)); return (v < 0 ? "-$" : "$") + s; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cls = (v) => (v < 0 ? "neg" : v > 0 ? "pos" : "");
const parseNum = (v) => { const s = String(v).replace(/[,$\s]/g, ""); if (s === "") return ""; const n = Number(s); return Number.isFinite(n) ? n : ""; };
const slug = (s) => String(s || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";

// ---------- state ----------
let rules = null;
let plans = [];
let activeId = null;
let ui = { showFlow: true, showOverlay: false, overlayId: null, splitCats: true, from: 0, to: null };
let result = null;
let overlayRes = null;
const history = {};
let saveTimer = 0;

const plan = () => plans.find((p) => p.id === activeId);
const hist = () => (history[activeId] ||= { undo: [], redo: [], key: null, t: 0 });

function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE) || "null"); if (s && Array.isArray(s.plans) && s.plans.length) { plans = s.plans.map((p) => { try { return normalize(p); } catch { return null; } }).filter(Boolean); activeId = s.active; } } catch { /* private mode or corrupt: reseed */ }
  try { Object.assign(ui, JSON.parse(localStorage.getItem(UIKEY) || "{}")); } catch { /* ignore */ }
  ui.from = 0; ui.to = null;
  if (!plans.length) { plans = [boardSheetPlan(), starterPlan()]; activeId = plans[0].id; }
  if (!plans.some((p) => p.id === activeId)) activeId = plans[0].id;
}
function saveNow() {
  try { localStorage.setItem(STORE, JSON.stringify({ v: 1, active: activeId, plans })); localStorage.setItem(UIKEY, JSON.stringify({ showFlow: ui.showFlow, showOverlay: ui.showOverlay, overlayId: ui.overlayId, splitCats: ui.splitCats })); } catch { /* storage blocked: the plan still works for this visit */ }
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
window.addEventListener("beforeunload", saveNow);

function defaultSettings() { return { capital: rules.code.startingCredits, taxPct: rules.economy.exchange.salesTaxPct, downtime: false, extraDays: 0 }; }
function starterPlan() {
  return { id: newId("plan"), name: "Starter plan", settings: defaultSettings(), phases: [{ id: newId("p"), name: "Phase 1", collapsed: false, days: Array.from({ length: 7 }, () => newDay()) }] };
}
function uniqueName(base) { let n = 1, name = base; const names = new Set(plans.map((p) => p.name)); while (names.has(name)) name = `${base} ${++n}`; return name; }
function normalize(p) {
  if (!p || !Array.isArray(p.phases)) throw new Error("not a plan: it has no phases list");
  const out = structuredClone(p);
  out.id = out.id || newId("plan");
  out.name = String(out.name || "Imported plan");
  out.settings = { ...(rules ? defaultSettings() : {}), ...(out.settings || {}) };
  for (const ph of out.phases) {
    ph.id ||= newId("p"); ph.name = String(ph.name ?? "Phase"); ph.collapsed = !!ph.collapsed; ph.days = Array.isArray(ph.days) ? ph.days : [];
    for (const d of ph.days) { d.id ||= newId("d"); d.note = String(d.note ?? ""); d.actions = Array.isArray(d.actions) ? d.actions : []; for (const a of d.actions) { a.id ||= newId("a"); if (!KINDS.includes(a.kind)) a.kind = "custom"; } }
  }
  return out;
}
function reid(p) {
  const c = structuredClone(p); c.id = newId("plan");
  for (const ph of c.phases) { ph.id = newId("p"); for (const d of ph.days) { d.id = newId("d"); for (const a of d.actions) a.id = newId("a"); } }
  return c;
}

// ---------- undo ----------
function pushUndo(key) {
  const h = hist(), now = Date.now();
  if (key && h.key === key && now - h.t < 1500) { h.t = now; return; }
  h.undo.push(JSON.stringify(plan())); if (h.undo.length > MAX_UNDO) h.undo.shift();
  h.redo = []; h.key = key; h.t = now; undoUi();
}
function restore(json) {
  const i = plans.findIndex((p) => p.id === activeId);
  plans[i] = JSON.parse(json);
  hist().key = null;
  fullRender();
}
function undo() { const h = hist(); if (!h.undo.length) return; h.redo.push(JSON.stringify(plan())); restore(h.undo.pop()); toast("Undone"); }
function redo() { const h = hist(); if (!h.redo.length) return; h.undo.push(JSON.stringify(plan())); restore(h.redo.pop()); toast("Redone"); }
function undoUi() { const h = hist(); $("#undo").disabled = !h.undo.length; $("#redo").disabled = !h.redo.length; $("#undo").title = `Undo (Ctrl+Z), ${h.undo.length} step${h.undo.length === 1 ? "" : "s"} kept`; }

// ---------- edits ----------
let recomputeTimer = 0;
function scheduleRecompute() { clearTimeout(recomputeTimer); recomputeTimer = setTimeout(recompute, 150); }
/** A field edit: no editor rebuild (that would drop focus), coalesced into one undo step per field. */
function edit(key, fn) { pushUndo(key); fn(); save(); scheduleRecompute(); }
/** A structural edit: the editor is rebuilt and the plan recomputed at once. */
function structural(fn) { pushUndo(null); fn(); save(); renderEditor(); recompute(); }

function locDay(id) { for (const ph of plan().phases) { const i = ph.days.findIndex((d) => d.id === id); if (i >= 0) return { ph, i, day: ph.days[i] }; } return null; }
function locAction(id) { for (const ph of plan().phases) for (const day of ph.days) { const i = day.actions.findIndex((a) => a.id === id); if (i >= 0) return { ph, day, i, a: day.actions[i] }; } return null; }
const locPhase = (id) => { const p = plan(); const i = p.phases.findIndex((x) => x.id === id); return i < 0 ? null : { ph: p.phases[i], i }; };
const swap = (arr, i, j) => { if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };

// ---------- rules ----------
async function loadRules() {
  const res = await fetch("/rules.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`/rules.json answered ${res.status}: ${await res.text()}`);
  rules = await res.json();
  $("#rules-tag").textContent = `rules: data @ ${rules.commit}`;
  $("#rules-tag").title = `${rules.research.length} technologies, ${rules.leases.length} leases, ${rules.economy.npcBuyers.length} buyers`;
}
function banner(msg) { const b = $("#banner"); b.hidden = !msg; b.textContent = msg || ""; }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = "none"; }, 1800); }

// ---------- editor ----------
const fld = (label, inner, c = "") => `<label class="mf ${c}"><span>${label}</span>${inner}</label>`;
const numIn = (f, v, o = {}) => `<input type="number" data-f="${f}" data-t="num" value="${esc(v ?? "")}"${o.min != null ? ` min="${o.min}"` : ""}${o.max != null ? ` max="${o.max}"` : ""}${o.step ? ` step="${o.step}"` : ""} placeholder="${esc(o.ph || "")}">`;
const moneyIn = (f, v, rule) => `<input type="text" inputmode="decimal" data-f="${f}" data-t="num" class="money${rule && v !== "" && v != null ? " ov" : ""}" value="${esc(v ?? "")}" placeholder="0" autocomplete="off">`;
const chk = (f, v, label) => `<label class="mf chk"><input type="checkbox" data-f="${f}" data-t="bool"${v ? " checked" : ""}><span>${label}</span></label>`;
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;

function bodyOptions(cur) {
  const bySystem = new Map();
  for (const l of rules.leases) (bySystem.get(l.system) || bySystem.set(l.system, []).get(l.system)).push(l);
  return [...bySystem].map(([sys, ls]) => `<optgroup label="${esc(sys)}">${ls.map((l) => opt(l.body, `${l.body} · ${fmt(l.cost)}`, cur)).join("")}</optgroup>`).join("");
}
function techOptions(cur) {
  const groups = new Map();
  for (const r of rules.research) { const k = `Tier ${r.tier} · ${r.category}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  return [...groups].map(([g, rs]) => `<optgroup label="${esc(g)}">${rs.map((r) => opt(r.id, `${r.name} · ${fmt(r.costCredits)} · ${r.durationHours} h`, cur)).join("")}</optgroup>`).join("");
}
const itemOptions = (cur) => rules.economy.npcBuyers.map((b) => opt(b.item, `${b.item} ($${b.unitPrice})`, cur || "Silicates")).join("");

function actionHTML(a) {
  const k = a.kind, id = a.id;
  const ov = k !== "custom" && ["upfront", "perHour", "perDay"].some((f) => a[f] !== "" && a[f] != null);
  let main = "", prices = [];
  switch (k) {
    case "custom":
      main = `<button class="badge b-custom ${a.income ? "inc" : ""} income-toggle" data-act="toggle-income" title="Click to switch between income and expense">${a.income ? "Income" : "Expense"}</button>` +
        fld("name", `<input type="text" data-f="name" data-t="text" value="${esc(a.name || "")}" placeholder="${esc(defaultName(a, rules))}" spellcheck="false">`, "grow") +
        fld("category", `<input type="text" data-f="category" data-t="text" list="cats" value="${esc(a.category || "")}" placeholder="other" ${a.income ? "disabled" : ""} style="width:92px">`);
      prices = ["upfront", "perHour", "perDay"]; break;
    case "office": main = fld("term", `<select data-f="termDays" data-t="num">${rules.economy.office.termDays.map((d) => opt(d, `${d} days`, a.termDays)).join("")}</select>`, "w-term") + chk("renew", a.renew, "renew"); prices = ["upfront"]; break;
    case "hire": main = fld("people", numIn("count", a.count, { min: 0 })); prices = ["upfront", "perDay"]; break;
    case "lease": main = fld("body", `<select data-f="body" data-t="text">${bodyOptions(a.body)}</select>`, "w-body"); prices = ["upfront"]; break;
    case "yard": main = ""; prices = ["upfront"]; break;
    case "cycle":
      main = fld("yard #", numIn("yard", a.yard, { min: 1 })) + fld("t/hour", numIn("throughput", a.throughput, { min: rules.code.minThroughput, max: rules.code.maxThroughput })) +
        fld("hours", numIn("hours", a.hours, { min: 1, max: rules.code.maxCycleHours })) + chk("continuous", a.continuous, "restarts") + fld("item", `<select data-f="item" data-t="text">${itemOptions(a.item)}</select>`, "w-item");
      prices = ["upfront", "perHour"]; break;
    case "research": main = fld("technology", `<select data-f="tech" data-t="text">${techOptions(a.tech)}</select>`, "w-tech"); prices = ["upfront"]; break;
  }
  const PL = { upfront: k === "cycle" ? "startup" : "upfront", perHour: "per hour", perDay: "per day" };
  const price = prices.map((f) => fld(PL[f], moneyIn(f, a[f], k !== "custom"), "")).join("");
  const dur = ["custom", "office", "hire", "cycle"].includes(k) ? fld("for (days)", numIn("durationDays", a.durationDays, { min: 0, ph: "ongoing" }), "w-dur") : "";
  return `<div class="act k-${k}${ov ? " has-ov" : ""}" data-action="${id}">
    <div class="a1"><span class="badge b-${k}${k === "custom" && a.income ? " inc" : ""}">${KIND_LABEL[k]}</span>${main}
      <span class="tools"><button class="ib" data-act="action-up" title="Move up">↑</button><button class="ib" data-act="action-down" title="Move down">↓</button><button class="ib" data-act="action-dup" title="Duplicate">⧉</button><button class="ib del" data-act="action-del" title="Delete action">✕</button></span></div>
    <div class="a2">${fld("hour", numIn("hour", a.hour, { min: 0, max: 23 }), "w-hour")}${dur}${price}<button class="ib rst" data-act="ov-reset" title="Clear the overrides: use the game's price">↺</button><span class="pnote" data-note></span></div>
  </div>`;
}

function dayHTML(day, n) {
  return `<article class="day" id="d-${day.id}" data-day="${day.id}">
    <header class="day-h"><b class="dn">Day ${n}</b>
      <input class="note" data-f="day-note" value="${esc(day.note)}" placeholder="note…" aria-label="Day ${n} note" spellcheck="false">
      <span class="dinfo" data-dinfo></span>
      <select class="addsel" data-act="add-action" aria-label="Add action to day ${n}"><option value="">+ Action</option>${KINDS.map((k) => `<option value="${k}">${KIND_MENU[k]}</option>`).join("")}</select>
      <span class="tools"><button class="ib" data-act="day-dup" title="Duplicate day">⧉</button><button class="ib" data-act="day-repeat" title="Repeat day ×N">×N</button><button class="ib" data-act="day-up" title="Move day up">↑</button><button class="ib" data-act="day-down" title="Move day down">↓</button><button class="ib del" data-act="day-del" title="Delete day">✕</button></span>
      <span class="inl" hidden><input type="number" data-n min="1" max="90" value="3" aria-label="Repeat count"><button class="btn sm" data-act="day-repeat-go">Repeat</button></span>
    </header>
    <div class="actions">${day.actions.map(actionHTML).join("")}</div>
  </article>`;
}

function phaseHTML(ph, startN, idx, count) {
  let n = startN;
  const days = ph.days.map((d) => dayHTML(d, n++)).join("");
  const range = ph.days.length ? `Days ${startN}–${startN + ph.days.length - 1}` : "no days";
  return `<section class="phase${ph.collapsed ? " collapsed" : ""}" data-phase="${ph.id}">
    <header class="phase-h">
      <button class="ib chev" data-act="phase-toggle" aria-label="Collapse or expand phase" title="Collapse / expand">▾</button>
      <input class="phase-name" data-f="phase-name" value="${esc(ph.name)}" aria-label="Phase name" spellcheck="false">
      <span class="chip">${range}</span>
      <span class="tools"><button class="ib" data-act="phase-up" title="Move phase up"${idx === 0 ? " disabled" : ""}>↑</button><button class="ib" data-act="phase-down" title="Move phase down"${idx === count - 1 ? " disabled" : ""}>↓</button><button class="ib del" data-act="phase-del" title="Delete phase">✕</button></span>
      <span class="psum" data-pinfo></span>
    </header>
    <div class="phase-body">${days}
      <div class="phase-foot"><button class="btn sm" data-act="day-add">+ Add day</button><button class="btn sm" data-act="days-add">+ Add days…</button>
        <span class="inl" hidden><input type="number" data-n min="1" max="90" value="7" aria-label="How many days"><button class="btn sm" data-act="days-add-go">Add</button></span></div>
    </div>
  </section>`;
}

function renderEditor() {
  const p = plan(); let n = 1;
  const phases = p.phases.map((ph, i) => { const h = phaseHTML(ph, n, i, p.phases.length); n += ph.days.length; return h; }).join("");
  $("#editor").innerHTML = `<datalist id="cats">${CATS.map((c) => `<option value="${c}">`).join("")}</datalist>` + (phases || `<p class="dim">No phases yet. Add one to start.</p>`);
}

function approxCtx(a) {
  let yardsOwned = 0;
  outer: for (const { day } of flattenDays(plan())) for (const x of day.actions) { if (x.id === a.id) break outer; if (x.kind === "yard") yardsOwned++; }
  return { yardsOwned, supplyForecast: false };
}
function gamePrice(a) {
  const p = result.priced[a.id]; if (!p) return null;
  if (!p.overridden) return p;
  return priceAction({ ...a, upfront: "", perHour: "", perDay: "" }, rules, approxCtx(a));
}

/** After a recompute: fill the numbers the simulation owns into the editor, without rebuilding it. */
function updateEditorInfo() {
  const flat = flattenDays(plan());
  const dayEls = new Map($$("[data-day]").map((el) => [el.dataset.day, el]));
  for (const { n, day } of flat) {
    const el = dayEls.get(day.id), r = result.days[n - 1]; if (!el) continue;
    const info = $("[data-dinfo]", el);
    info.innerHTML = r ? `<i class="${cls(r.net)}">${fmt(r.net)}</i> → <i class="${r.cash < 0 ? "neg" : ""}">${fmt(r.cash)}</i>` : "";
    info.title = r ? `Day ${n}: net ${fmt(r.net)}, cash at the end ${fmt(r.cash)}` : "";
  }
  $$(".phase").forEach((el) => {
    const s = result.phases.find((x) => x.id === el.dataset.phase); const out = $("[data-pinfo]", el);
    out.innerHTML = s && s.days ? `net <i class="${cls(s.net)}">${fmt(s.net)}</i> · end <i class="${s.endCash < 0 ? "neg" : ""}">${fmt(s.endCash)}</i> · lowest <i class="${s.low < 0 ? "neg" : ""}">${fmt(s.low)}</i>` : "";
    out.querySelectorAll("i").forEach((i) => { i.style.fontStyle = "normal"; });
  });
  $$("[data-action]").forEach((el) => {
    const loc = locAction(el.dataset.action); if (!loc) return; const a = loc.a;
    const p = result.priced[a.id];
    const note = p && a.kind !== "custom" ? p.note : "";
    $("[data-note]", el).textContent = note; $("[data-note]", el).title = note;
    if (a.kind === "custom") return;
    const g = gamePrice(a); if (!g) return;
    for (const f of ["upfront", "perHour", "perDay"]) {
      const input = $(`[data-f="${f}"]`, el); if (!input) continue;
      input.placeholder = fmtNum(g[f]);
      input.title = input.classList.contains("ov") ? `game price: ${fmt(g[f])}` : "the game's price (type to override)";
    }
  });
}

// ---------- editor events ----------
function onField(t) {
  const f = t.dataset.f; if (!f) return;
  const val = t.dataset.t === "bool" ? t.checked : t.dataset.t === "num" ? parseNum(t.value) : t.value;
  const aEl = t.closest("[data-action]");
  if (aEl) {
    const loc = locAction(aEl.dataset.action); if (!loc) return;
    edit(`a:${loc.a.id}:${f}`, () => { loc.a[f] = val; });
    if (["upfront", "perHour", "perDay"].includes(f) && loc.a.kind !== "custom") {
      t.classList.toggle("ov", val !== "");
      aEl.classList.toggle("has-ov", ["upfront", "perHour", "perDay"].some((x) => loc.a[x] !== "" && loc.a[x] != null));
    }
    return;
  }
  const dEl = t.closest("[data-day]");
  if (f === "day-note" && dEl) { const loc = locDay(dEl.dataset.day); edit(`n:${dEl.dataset.day}`, () => { loc.day.note = t.value; }); return; }
  const pEl = t.closest("[data-phase]");
  if (f === "phase-name" && pEl) { const loc = locPhase(pEl.dataset.phase); edit(`pn:${pEl.dataset.phase}`, () => { loc.ph.name = t.value; }); return; }
  if (f === "plan-name") { edit("plan-name", () => { plan().name = t.value; }); const o = $(`#plan-select option[value="${activeId}"]`); if (o) o.textContent = t.value || "(unnamed)"; return; }
  if (f.startsWith("set-")) { const key = f.slice(4); edit(`s:${key}`, () => { plan().settings[key] = val; }); }
}
document.addEventListener("input", (e) => { if (e.target.dataset && e.target.dataset.f) onField(e.target); });

function addDays(ph, at, count, make = newDay) { ph.days.splice(at, 0, ...Array.from({ length: count }, make)); }
function goToDay(ref) {
  let el = typeof ref === "number" ? $$("[data-day]")[ref - 1] : $(`[data-day="${ref}"]`);
  if (!el) return;
  const phEl = el.closest(".phase");
  if (phEl.classList.contains("collapsed")) { phEl.classList.remove("collapsed"); const loc = locPhase(phEl.dataset.phase); if (loc) { loc.ph.collapsed = false; save(); } }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}
function ask(msg) { return window.confirm(msg); }

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("select.addsel") && t.value) {
    const kind = t.value, loc = locDay(t.closest("[data-day]").dataset.day);
    structural(() => { loc.day.actions.push(newAction(kind, rules)); });
    const dayId = loc.day.id; const rows = $$(`[data-day="${dayId}"] [data-action]`); const last = rows[rows.length - 1];
    if (last) { const first = last.querySelector("input:not([type=checkbox]), select"); if (first) first.focus({ preventScroll: true }); last.scrollIntoView({ block: "nearest" }); }
  }
  if (t.id === "import-file" && t.files[0]) importFile(t.files[0]);
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || ["SELECT", "OPTION"].includes(b.tagName) || b.disabled) return;
  const act = b.dataset.act;
  const pEl = b.closest("[data-phase]"), dEl = b.closest("[data-day]"), aEl = b.closest("[data-action]");
  const P = pEl && locPhase(pEl.dataset.phase), D = dEl && locDay(dEl.dataset.day), A = aEl && locAction(aEl.dataset.action);
  const nIn = (el) => clamp(Math.floor(Number($("input[data-n]", el).value)) || 1, 1, 90);
  switch (act) {
    case "undo": return undo();
    case "redo": return redo();
    case "plan-new": { const p = { ...starterPlan(), name: uniqueName("New plan") }; pushPlanList(p); toast("New plan"); $("#plan-name").focus(); $("#plan-name").select(); return; }
    case "plan-dup": { const c = reid(plan()); c.name = uniqueName(`${plan().name} copy`); pushPlanList(c); return toast("Duplicated"); }
    case "plan-rename": $("#plan-name").focus(); $("#plan-name").select(); return;
    case "plan-del": {
      if (!ask(`Delete the plan "${plan().name}"? This cannot be undone.`)) return;
      const i = plans.findIndex((p) => p.id === activeId); delete history[activeId]; plans.splice(i, 1);
      if (!plans.length) plans.push(starterPlan());
      activeId = plans[Math.min(i, plans.length - 1)].id; save(); return fullRender();
    }
    case "plan-import": return $("#import-file").click();
    case "plan-export": return download(`${slug(plan().name)}.json`, JSON.stringify(plan(), null, 2), "application/json");
    case "csv": return download(`${slug(plan().name)}-days.csv`, csv(), "text/csv");
    case "phase-add": return structural(() => { plan().phases.push(newPhase(`Phase ${plan().phases.length + 1}`)); });
    case "phases-collapse": case "phases-expand": plan().phases.forEach((ph) => { ph.collapsed = act === "phases-collapse"; }); $$(".phase").forEach((el) => el.classList.toggle("collapsed", act === "phases-collapse")); return save();
    case "phase-toggle": P.ph.collapsed = !P.ph.collapsed; pEl.classList.toggle("collapsed", P.ph.collapsed); return save();
    case "phase-up": return structural(() => swap(plan().phases, P.i, P.i - 1));
    case "phase-down": return structural(() => swap(plan().phases, P.i, P.i + 1));
    case "phase-del": if (!ask(`Delete the phase "${P.ph.name}" and its ${P.ph.days.length} day(s)?`)) return; return structural(() => { plan().phases.splice(P.i, 1); });
    case "day-add": return structural(() => addDays(P.ph, P.ph.days.length, 1));
    case "days-add": { const box = b.parentElement.querySelector(".inl"); box.hidden = !box.hidden; if (!box.hidden) box.querySelector("input").select(); return; }
    case "days-add-go": return structural(() => addDays(P.ph, P.ph.days.length, nIn(b.parentElement)));
    case "day-dup": return structural(() => { D.ph.days.splice(D.i + 1, 0, cloneDay(D.day)); });
    case "day-repeat": { const box = b.closest(".day-h").querySelector(".inl"); box.hidden = !box.hidden; if (!box.hidden) box.querySelector("input").select(); return; }
    case "day-repeat-go": { const n = nIn(b.parentElement); return structural(() => { D.ph.days.splice(D.i + 1, 0, ...Array.from({ length: n }, () => cloneDay(D.day))); }); }
    case "day-up": return structural(() => swap(D.ph.days, D.i, D.i - 1));
    case "day-down": return structural(() => swap(D.ph.days, D.i, D.i + 1));
    case "day-del": return structural(() => { D.ph.days.splice(D.i, 1); });
    case "action-up": return structural(() => swap(A.day.actions, A.i, A.i - 1));
    case "action-down": return structural(() => swap(A.day.actions, A.i, A.i + 1));
    case "action-dup": return structural(() => { A.day.actions.splice(A.i + 1, 0, { ...A.a, id: newId("a") }); });
    case "action-del": return structural(() => { A.day.actions.splice(A.i, 1); });
    case "toggle-income": return structural(() => { A.a.income = !A.a.income; });
    case "ov-reset": return structural(() => { A.a.upfront = ""; A.a.perHour = ""; A.a.perDay = ""; });
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input[data-n]")) { e.preventDefault(); e.target.parentElement.querySelector("button").click(); }
  if (e.key === "Escape" && e.target.matches("input[data-n]")) e.target.parentElement.hidden = true;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
});

// ---------- plans ----------
function pushPlanList(p) { plans.push(p); activeId = p.id; save(); fullRender(); }
function renderPlanBar() {
  $("#plan-select").innerHTML = plans.map((p) => opt(p.id, p.name || "(unnamed)", activeId)).join("");
  $("#plan-name").value = plan().name;
  const others = plans.filter((p) => p.id !== activeId);
  if (!others.some((p) => p.id === ui.overlayId)) ui.overlayId = others[0]?.id || null;
  $("#ov-select").innerHTML = others.map((p) => opt(p.id, p.name, ui.overlayId)).join("");
  $("#ov-select").disabled = !others.length; $("#t-overlay").disabled = !others.length;
  $("#t-overlay").checked = ui.showOverlay && !!others.length;
  $("#t-flow").checked = ui.showFlow; $("#t-split").checked = ui.splitCats;
}
function renderSettings() {
  const s = plan().settings;
  $("#s-capital").value = s.capital ?? ""; $("#s-capital").placeholder = fmtNum(rules.code.startingCredits);
  $("#s-tax").value = s.taxPct ?? ""; $("#s-tax").placeholder = String(rules.economy.exchange.salesTaxPct);
  $("#s-extra").value = s.extraDays ?? 0; $("#s-down").checked = !!s.downtime;
}
$("#plan-select").addEventListener("change", (e) => { activeId = e.target.value; ui.from = 0; ui.to = null; save(); fullRender(); });
function importFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const raw = JSON.parse(r.result); const list = Array.isArray(raw) ? raw : [raw];
      const made = list.map((x) => { const p = reid(normalize(x)); p.name = uniqueName(p.name); plans.push(p); return p; });
      activeId = made[0].id; save(); fullRender(); toast(`Imported ${made.length} plan${made.length === 1 ? "" : "s"}`);
    } catch (err) { banner(`Could not import ${file.name}: ${err.message}`); setTimeout(() => banner(""), 6000); }
  };
  r.readAsText(file); $("#import-file").value = "";
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- results ----------
function recompute() {
  banner("");
  try { result = simulate(plan(), rules); } catch (err) { banner(`The simulation failed: ${err.message}`); console.error(err); return; }
  overlayRes = null;
  if (ui.showOverlay) { const o = plans.find((p) => p.id === ui.overlayId && p.id !== activeId); if (o) try { overlayRes = simulate(o, rules); } catch { /* overlay is optional */ } }
  renderResults(); updateEditorInfo();
}
function fullRender() { renderPlanBar(); renderSettings(); renderEditor(); undoUi(); recompute(); }

function renderResults() { renderKpis(); renderChart(); renderWarnings(); renderPhaseTable(); renderDayTable(); }

function renderKpis() {
  const k = result.kpis, n = result.days.length;
  const lowDay = k.lowest.day ? `on day ${k.lowest.day}` : "at the start";
  const dipped = result.days.some((d) => d.low < result.capital);
  const k1 = (label, val, c, sub) => `<div class="kpi"><span>${label}</span><b class="${c || ""}">${val}</b><small>${sub || "&nbsp;"}</small></div>`;
  $("#kpis").innerHTML =
    k1("Day 1 spend", n ? fmt(-(k.day1Spend || 0)) : "n/a", k.day1Spend ? "neg" : "", "upfront + first day") +
    k1("Lowest cash", fmt(k.lowest.cash), k.lowest.cash < 0 ? "neg" : "", lowDay) +
    k1("Profit / day", fmt(k.lastNet), cls(k.lastNet), n ? `on day ${n}` : "") +
    k1("Break-even", k.breakEven ? `Day ${k.breakEven}` : dipped ? "not reached" : "no dip", k.breakEven ? "pos" : dipped ? "neg" : "pos", dipped ? "back to starting capital" : "never below capital") +
    k1("Goes broke", k.broke ? `Day ${k.broke}` : "Never", k.broke ? "neg" : "pos", k.broke ? "cash below zero" : `in ${n} day${n === 1 ? "" : "s"}`) +
    k1("End cash", fmt(k.endCash), k.endCash < 0 ? "neg" : "", `${k.endCash - result.capital >= 0 ? "+" : ""}${fmt(k.endCash - result.capital)} vs start`);
}

function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw)); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

function chartGeom() {
  const nDays = result.days.length;
  const from = clamp(Math.floor(ui.from || 0), 0, Math.max(0, nDays - 1));
  const to = ui.to == null ? nDays : clamp(Math.floor(ui.to), from + 1, nDays);
  return { nDays, from, to, h0: from * HOURS, h1: to * HOURS };
}
function syncRange() {
  const g = chartGeom();
  const rf = $("#r-from"), rt = $("#r-to");
  rf.max = Math.max(0, g.nDays - 1); rf.value = g.from; rt.min = 1; rt.max = Math.max(1, g.nDays); rt.value = g.to;
  $("#o-from").textContent = g.from; $("#o-to").textContent = g.to;
  rf.disabled = rt.disabled = g.nDays < 2;
}

function renderChart() {
  const wrap = $("#chart"), R = result, g = chartGeom();
  syncRange();
  if (!g.nDays) { wrap.innerHTML = `<p class="empty">Add a day to see the chart.</p>`; $("#legend").innerHTML = ""; return; }
  const { h0, h1 } = g;
  const W = 900, H = 400, L = 62, RR = 16, T = 26, B = 34, pw = W - L - RR, ph = H - T - B;
  const ov = ui.showOverlay ? overlayRes : null;
  let min = Math.min(0, R.capital), max = Math.max(0, R.capital);
  for (let h = h0; h <= h1; h++) { const v = R.hourly[h]; if (v < min) min = v; if (v > max) max = v; if (ov && ov.hourly[h] != null) { const w = ov.hourly[h]; if (w < min) min = w; if (w > max) max = w; } }
  if (ui.showFlow) for (const d of R.days) if (d.day > g.from && d.day <= g.to) { if (d.net < min) min = d.net; if (d.net > max) max = d.net; }
  const step = niceStep((max - min || 1) / 5); min = Math.floor(min / step) * step; max = Math.ceil(max / step) * step; if (min === max) max = min + step;
  const X = (h) => L + ((h - h0) / (h1 - h0)) * pw, Y = (v) => T + (1 - (v - min) / (max - min)) * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash over time"><defs><linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fd8e8" stop-opacity=".18"/><stop offset="1" stop-color="#4fd8e8" stop-opacity="0"/></linearGradient><clipPath id="plot"><rect x="${L}" y="${T - 4}" width="${pw}" height="${ph + 8}"/></clipPath></defs>`;
  // phase bands
  s += `<g clip-path="url(#plot)">`;
  let bi = 0, planned = 0;
  for (const p of R.phases) {
    if (!p.days) continue; planned = p.to;
    const x0 = X((p.from - 1) * HOURS), x1 = X(p.to * HOURS);
    s += `<rect class="band${bi++ % 2}" x="${x0}" y="${T}" width="${Math.max(0, x1 - x0)}" height="${ph}"/>`;
    const vx0 = Math.max(x0, L), vx1 = Math.min(x1, L + pw), room = Math.floor((vx1 - vx0 - 8) / 6);
    if (room >= 3) s += `<text class="bandlbl" x="${vx0 + 5}" y="${T + 12}">${esc(p.name.length > room ? p.name.slice(0, room - 1) + "…" : p.name)}</text>`;
  }
  if (g.nDays > planned) { const x0 = X(planned * HOURS), x1 = X(g.nDays * HOURS); s += `<rect class="bandx" x="${x0}" y="${T}" width="${x1 - x0}" height="${ph}"/><text class="bandlbl" x="${Math.max(x0, L) + 5}" y="${T + 12}">projected</text>`; }
  s += `</g>`;
  // grid
  for (let v = min; v <= max + step / 1000; v += step) s += `<line class="grid" x1="${L}" x2="${W - RR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${L - 7}" y="${Y(v) + 4}" text-anchor="end">${fmtK(v)}</text>`;
  const spanDays = to_(g);
  const dstep = [1, 2, 5, 7, 10, 14, 20, 30, 50, 100].find((x) => spanDays / x <= 14) || 100;
  for (let d = Math.ceil(g.from / dstep) * dstep; d <= g.to; d += dstep) s += `<line class="grid" x1="${X(d * HOURS)}" x2="${X(d * HOURS)}" y1="${T}" y2="${T + ph}" opacity=".5"/><text class="axis" x="${X(d * HOURS)}" y="${H - 14}" text-anchor="middle">D${d}</text>`;
  s += `<text class="axis" x="${L + pw / 2}" y="${H - 1}" text-anchor="middle" opacity=".7">day (cash at the end of the day)</text>`;
  // net-flow bars
  if (ui.showFlow) for (const d of R.days) {
    if (d.day <= g.from || d.day > g.to) continue;
    const xa = X((d.day - 1) * HOURS), xb = X(d.day * HOURS), bw = Math.max(1.5, (xb - xa) * 0.56), y0 = Y(0), y1 = Y(d.net);
    s += `<rect class="${d.net < 0 ? "bar-n" : "bar-p"}" x="${(xa + xb) / 2 - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1, Math.abs(y1 - y0))}"/>`;
  }
  // reference lines
  s += `<line class="zero" x1="${L}" x2="${W - RR}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  if (R.capital !== 0) s += `<line class="cap" x1="${L}" x2="${W - RR}" y1="${Y(R.capital)}" y2="${Y(R.capital)}"/><text class="axis" x="${W - RR - 4}" y="${Y(R.capital) - 5}" text-anchor="end" fill="#e8a34f" style="fill:#e8a34f">starting capital ${fmtK(R.capital)}</text>`;
  // lines
  const pts = (hr) => { const stp = Math.max(1, Math.floor((h1 - h0) / 1400)); const out = []; for (let h = h0; h <= h1 && h < hr.length; h += stp) out.push(`${X(h).toFixed(1)},${Y(hr[h]).toFixed(1)}`); const last = Math.min(h1, hr.length - 1); if ((last - h0) % stp) out.push(`${X(last).toFixed(1)},${Y(hr[last]).toFixed(1)}`); return out.join(" "); };
  const ptsA = pts(R.hourly);
  s += `<g clip-path="url(#plot)"><polygon class="area" points="${X(h0)},${Y(0)} ${ptsA} ${X(h1)},${Y(0)}"/>`;
  if (ov) s += `<polyline class="l-b" points="${pts(ov.hourly)}"/>`;
  s += `<polyline class="l-a" points="${ptsA}"/></g>`;
  // markers
  const k = R.kpis;
  if (k.broke) { const bh = R.hourly.findIndex((v, i) => i > 0 && v < 0); if (bh >= h0 && bh <= h1) s += `<line class="broke" x1="${X(bh)}" x2="${X(bh)}" y1="${T}" y2="${T + ph}"/><text class="mk-t" x="${X(bh) + 5}" y="${T + 26}" fill="#f697a0" style="fill:#f697a0">broke D${k.broke}</text>`; }
  if (k.breakEven) { let be = (k.breakEven - 1) * HOURS; for (let h = be + 1; h <= k.breakEven * HOURS; h++) if (R.hourly[h] >= R.capital && R.hourly[h - 1] < R.capital) { be = h; break; } if (be >= h0 && be <= h1) s += `<line class="be" x1="${X(be)}" x2="${X(be)}" y1="${T}" y2="${T + ph}"/><text class="mk-t" x="${X(be) + 5}" y="${T + 40}" style="fill:#e8a34f">break-even D${k.breakEven}</text>`; }
  const lowH = R.hourly.indexOf(Math.min(...R.hourly));
  if (lowH >= h0 && lowH <= h1) { const lx = X(lowH), flip = lx > L + pw * 0.7; s += `<circle cx="${lx}" cy="${Y(R.hourly[lowH])}" r="6" fill="none" stroke="#f697a0" stroke-width="2"/><text class="mk-t" x="${flip ? lx - 10 : lx + 10}" y="${Y(R.hourly[lowH]) + (R.hourly[lowH] > min + (max - min) * 0.15 ? 16 : -10)}" text-anchor="${flip ? "end" : "start"}" style="fill:#f697a0">lowest ${fmt(R.hourly[lowH])}</text>`; }
  for (const ev of R.events) { if (ev.hour < h0 || ev.hour > h1 || ev.hour >= R.hourly.length) continue; const q = /starts/.test(ev.text), cx = X(ev.hour), cy = Y(R.hourly[ev.hour]); s += `<path class="${q ? "ev-q" : "ev"}" d="M${cx},${cy - 6} l5,6 l-5,6 l-5,-6 z"/>`; }
  s += `<g id="cross" style="display:none"><line class="cross" y1="${T}" y2="${T + ph}"/><circle r="4.5" fill="#4fd8e8" stroke="#05070a" stroke-width="1.5"/><circle id="cross2" r="4" fill="#c496ff" stroke="#05070a" stroke-width="1.5" style="display:none"/></g>`;
  s += `<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/></svg>`;
  wrap.innerHTML = s;
  const planName = plan().name, ovName = ov ? plans.find((p) => p.id === ui.overlayId)?.name : "";
  $("#legend").innerHTML = `<span><i style="background:var(--accent)"></i>${esc(planName)}</span>` + (ov ? `<span><i style="background:var(--b)"></i>${esc(ovName)} (overlay)</span>` : "") +
    (ui.showFlow ? `<span><i class="box" style="background:var(--success)"></i><i class="box" style="background:var(--danger)"></i>Daily net flow</span>` : "") +
    `<span><i style="background:var(--danger)"></i>Zero</span><span><i style="background:var(--warn)"></i>Capital / break-even</span><span><i style="background:#f2a0d2;height:8px;width:8px;transform:rotate(45deg)"></i>Research done</span>`;
  bindChartHover(wrap, { W, H, L, pw, h0, h1, T, ph, X, Y, ov });
}
const to_ = (g) => g.to - g.from;

function bindChartHover(wrap, c) {
  const svg = $("svg", wrap), hit = $(".hit", svg), cross = $("#cross", svg), dot2 = $("#cross2", svg), tip = $("#tip"), R = result;
  const line = $("line", cross), dot = $("circle", cross);
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * c.W;
    const h = clamp(Math.round(c.h0 + ((px - c.L) / c.pw) * (c.h1 - c.h0)), c.h0, Math.min(c.h1, R.hourly.length - 1));
    const x = c.X(h), v = R.hourly[h];
    cross.style.display = ""; line.setAttribute("x1", x); line.setAttribute("x2", x); dot.setAttribute("cx", x); dot.setAttribute("cy", c.Y(v));
    const dayN = h === 0 ? 1 : Math.ceil(h / HOURS), hh = h % HOURS, row = R.days[dayN - 1];
    const when = h === 0 ? "Start" : hh === 0 ? `Day ${dayN} end` : `Day ${dayN}, ${String(hh).padStart(2, "0")}:00`;
    const phase = R.phases.find((p) => p.days && dayN >= p.from && dayN <= p.to);
    let html = `<b>${when}</b>${phase ? ` <span class="dim">· ${esc(phase.name)}</span>` : ""}<br>Cash ${fmt(v)}`;
    if (v < 0) html = html.replace("Cash", "Cash (broke)");
    if (c.ov && c.ov.hourly[h] != null) { const w = c.ov.hourly[h]; dot2.style.display = ""; dot2.setAttribute("cx", x); dot2.setAttribute("cy", c.Y(w)); html += `<br><span style="color:var(--b)">Overlay ${fmt(w)}</span> <span class="dim">(${w - v >= 0 ? "+" : ""}${fmt(w - v)})</span>`; } else dot2.style.display = "none";
    if (row) html += `<br>Day net ${fmt(row.net)} <span class="dim">(in ${fmt(row.income)}, out ${fmt(-row.expenses)})</span>`;
    for (const ev of R.events) if (ev.hour >= (dayN - 1) * HOURS && ev.hour <= dayN * HOURS && Math.abs(ev.hour - h) <= 12) html += `<br><span style="color:#f2a0d2">◆ ${esc(ev.text)} (h${ev.hour % HOURS || 24})</span>`;
    tip.innerHTML = html; tip.style.display = "block";
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(e.clientX + 14 + tw > innerWidth ? e.clientX - tw - 14 : e.clientX + 14, 4, innerWidth - tw - 4) + "px";
    tip.style.top = clamp(e.clientY + 14, 4, innerHeight - th - 4) + "px";
  });
  hit.addEventListener("pointerleave", () => { tip.style.display = "none"; cross.style.display = "none"; });
  hit.addEventListener("click", () => { const h = Number(line.getAttribute("x1")) ? Math.round(c.h0 + ((Number(line.getAttribute("x1")) - c.L) / c.pw) * (c.h1 - c.h0)) : 0; goToDay(Math.max(1, Math.ceil(h / HOURS))); });
}

function renderWarnings() {
  const w = result.warnings, items = [];
  for (const x of w) items.push(`<li><button data-goto="${x.day}">Day ${x.day}</button><span>${esc(x.text)}</span></li>`);
  const un = Object.entries(result.unsold || {}).filter(([, t]) => t >= 1);
  for (const [item, t] of un) items.push(`<li class="info"><span class="dim">note</span><span>${Math.round(t).toLocaleString()} t of ${esc(item)} was mined but not sold by the end of the plan (the quota or the bid held it back).</span></li>`);
  if (!w.length) items.unshift(`<li class="ok"><span>No warnings.</span></li>`);
  $("#warns").innerHTML = items.join(""); $("#warn-count").textContent = `${w.length}`;
  $("#warn-count").style.color = w.length ? "var(--warn)" : "var(--success)";
}

function renderPhaseTable() {
  const rows = result.phases.map((p) => p.days
    ? `<tr><td class="name">${esc(p.name)}</td><td>${p.from}–${p.to}</td><td class="pos">${fmt(p.income)}</td><td>${fmt(-p.expenses)}</td><td class="${cls(p.net)}">${fmt(p.net)}</td><td class="${p.endCash < 0 ? "neg" : ""}">${fmt(p.endCash)}</td><td class="${p.low < 0 ? "neg" : ""}">${fmt(p.low)}</td></tr>`
    : `<tr><td class="name">${esc(p.name)}</td><td colspan="6" class="sub">no days</td></tr>`).join("");
  $("#phasetable").innerHTML = `<thead><tr><th>Phase</th><th>Days</th><th>Income</th><th>Expenses</th><th>Net</th><th>End cash</th><th>Lowest</th></tr></thead><tbody>${rows}</tbody>`;
}

function dayCols() {
  const seen = new Set(); for (const d of result.days) for (const c of Object.keys(d.byCat)) seen.add(c);
  const exp = [...seen].filter((c) => !INCOME_CATS.includes(c)).sort((a, b) => (CATS.indexOf(a) + 1 || 99) - (CATS.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return exp;
}
function renderDayTable() {
  const R = result, cats = ui.splitCats ? dayCols() : [];
  const k = R.kpis;
  const cell = (v, c = "") => `<td class="${cls(v)}${Math.round(v) === 0 ? " zero" : ""}${c === "first" ? " tot" : ""}">${Math.round(v) === 0 ? "·" : fmt(v)}</td>`;
  let body = "", last = null;
  for (const d of R.days) {
    if (d.phaseId !== last) { last = d.phaseId; const p = R.phases.find((x) => x.id === d.phaseId); body += `<tr class="ph"><td colspan="${8 + cats.length}">${p ? esc(p.name) : "Projected (extra days)"}</td></tr>`; }
    body += `<tr class="dayrow${k.broke === d.day || (k.lowest.day === d.day && d.low < 0) ? " low" : ""}${k.breakEven === d.day ? " be" : ""}" data-goto="${d.day}"><td class="name">Day ${d.day}</td>` +
      `<td class="pos">${Math.round(d.income) ? fmt(d.income) : "·"}</td><td>${Math.round(d.expenses) ? fmt(-d.expenses) : "·"}</td><td class="${cls(d.net)}">${fmt(d.net)}</td><td class="${cls(d.gainLoss)}">${fmt(d.gainLoss)}</td><td class="${d.cash < 0 ? "neg" : ""}">${fmt(d.cash)}</td>` +
      `<td>${d.sold ? Math.round(d.sold).toLocaleString() : "·"}</td><td>${d.avgBid ? "$" + d.avgBid.toFixed(2) : "·"}</td>` +
      cats.map((c, i) => cell(d.byCat[c] || 0, i === 0 ? "first" : "")).join("") + `</tr>`;
  }
  $("#daytable").innerHTML = `<thead><tr><th>Day</th><th>Income</th><th>Expenses</th><th>Net</th><th>Gain / loss</th><th>Cash</th><th>Sold t</th><th>Avg bid</th>${cats.map((c, i) => `<th class="${i === 0 ? "tot" : ""}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="8" class="sub">No days.</td></tr>`}</tbody>`;
}

function csv() {
  const R = result, cats = dayCols(), q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const head = ["Day", "Phase", "Income", ...cats.map((c) => `Expense: ${c}`), "Expenses", "Net", "Gain/loss", "Cash", "Mined t", "Sold t", "Avg bid"];
  const lines = [head.map(q).join(",")];
  for (const d of R.days) {
    const p = R.phases.find((x) => x.id === d.phaseId);
    lines.push([d.day, p ? p.name : "projected", Math.round(d.income), ...cats.map((c) => Math.round(-(d.byCat[c] || 0))), Math.round(d.expenses), Math.round(d.net), Math.round(d.gainLoss), Math.round(d.cash), Math.round(d.tonnes), Math.round(d.sold), d.avgBid ? d.avgBid.toFixed(2) : 0].map(q).join(","));
  }
  return lines.join("\n") + "\n";
}

// results-side events
document.addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) goToDay(Number(g.dataset.goto)); });
$("#t-flow").addEventListener("change", (e) => { ui.showFlow = e.target.checked; save(); renderChart(); });
$("#t-split").addEventListener("change", (e) => { ui.splitCats = e.target.checked; save(); renderDayTable(); });
$("#t-overlay").addEventListener("change", (e) => { ui.showOverlay = e.target.checked; save(); recompute(); });
$("#ov-select").addEventListener("change", (e) => { ui.overlayId = e.target.value; save(); recompute(); });
$("#r-from").addEventListener("input", (e) => { ui.from = Number(e.target.value); if (ui.to != null && ui.to <= ui.from) ui.to = ui.from + 1; renderChart(); });
$("#r-to").addEventListener("input", (e) => { const v = Number(e.target.value); ui.to = v >= result.days.length ? null : v; if (ui.from >= v) ui.from = Math.max(0, v - 1); renderChart(); });
$("#r-all").addEventListener("click", () => { ui.from = 0; ui.to = null; renderChart(); });
$("#reload-rules").addEventListener("click", async () => {
  try { await loadRules(); fullRender(); toast(`Rules reloaded @ ${rules.commit}`); } catch (err) { banner(`Could not reload the rules: ${err.message}`); }
});

// ---------- start ----------
(async function start() {
  try { await loadRules(); } catch (err) { banner(`Could not load /rules.json (is node scripts/planner.mjs running?): ${err.message}`); $("#rules-tag").textContent = "rules: unavailable"; return; }
  load();
  plans = plans.map(normalize);
  fullRender();
  window.planner = { get plan() { return plan(); }, get result() { return result; }, get plans() { return plans; }, get rules() { return rules; } }; // a handle for the playtest script
})();

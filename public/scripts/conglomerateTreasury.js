// ISP-206 (AB#901): the Conglomerate tab's Treasury and Hangar screens, and the tabs that hold them, as HTML. Pure: no
// DOM and no requests, so node tests read it. views/conglomerateBureau.js fetches, binds and draws what this returns.
//
// Every figure is the server's (GET .../treasury and .../hangar): the balance, the caller's allowance and the ledger
// page. A member without withdrawal rights is not offered a withdrawal; a role that has them sees what it may still
// take today before it asks. The ledger is the trust mechanism, so it is shown whole to those who may see it: who,
// what, how much, the balance after, and when, newest first, a page at a time.

import { escapeHtml } from "./html.js";
import { bureauTime } from "./conglomerateBureau.js";
import { codeSlotHtml } from "./sectionCodes.js"; // ISP-250 (AB#946): the drawn sections' document codes

const n = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const signed = (v) => (v > 0 ? `+${n(v)}` : v < 0 ? `−${n(-v)}` : "0");

/** What each ledger row's kind is called on screen. */
export const LEDGER_KINDS = {
  opening: "Opening balance",
  "charter-deposit": "Charter deposit",
  deposit: "Deposit",
  "custody-fee": "Custody fee",
  withdrawal: "Withdrawal",
  "withdrawal-announced": "Withdrawal announced",
  "withdrawal-blocked": "Withdrawal blocked",
  "withdrawal-failed": "Withdrawal failed",
  upkeep: "Daily upkeep",
  "upkeep-unpaid": "Upkeep not paid",
  "arrears-paid": "Arrears paid",
  level: "Level bought",
  "level-lost": "Level lost",
  dissolution: "Dissolution share",
  // ISP-213 (AB#908): the rows the station chain writes (ISP-210, ISP-211)
  "station-project": "Station project",
  "station-project-refund": "Station project refund",
  "station-built": "Station opened",
  "stake-buyout": "Stake buyout"
};
const kindLabel = (k) => LEDGER_KINDS[k] || escapeHtml(k);
/** A form's status line: a refusal in the warning tone, what happened in the success tone. */
const statusLine = (role, s) => `<p class="cong-form-status${s?.ok ? " cong-form-status--ok" : ""}" data-role="${role}" role="status">${escapeHtml(s?.text || "")}</p>`;

/** The Conglomerate tab's own tabs: Roster, Treasury, Hangar. The panels are drawn by the caller. */
export function hqTabsHtml(active, panels) {
  const tabs = [["roster", "Roster"], ["treasury", "Treasury"], ["hangar", "Hangar"], ["station", "Station"]]; // Station: ISP-213 (AB#908)
  return `
    <div class="ui-tabs cong-tabs" role="tablist" aria-label="Conglomerate">
      ${tabs.map(([id, label]) => `<button type="button" class="ui-tab" role="tab" id="cong-tab-${id}" aria-controls="cong-panel-${id}" aria-selected="${id === active}" tabindex="${id === active ? 0 : -1}" data-role="cong-tab" data-tab="${id}">${label}</button>`).join("")}
    </div>
    ${tabs.map(([id]) => `<div class="ui-tabpanel cong-tabpanel" role="tabpanel" id="cong-panel-${id}" aria-labelledby="cong-tab-${id}"${id === active ? "" : " hidden"}>${id === active ? panels[id] || "" : ""}</div>`).join("")}`;
}

/** A page of the ledger as a table that collapses to cards on a phone, with older and newer controls. */
export function ledgerHtml(ledger, { which, goods = false } = {}) {
  if (!ledger) return "";
  const scope = ledger.scope === "all" ? "Every movement, by every member." : "Your corporation's own movements. The founder and directors see every member's.";
  if (!ledger.total) {
    const why = ledger.scope === "own"
      ? `Your corporation has not moved ${goods ? "goods" : "credits"} in or out yet; its deposits appear here. The founder and directors see every member's movements.`
      : `Deposit ${goods ? "goods" : "credits"} above and the first row appears here.`;
    return `<div class="ui-state" role="status"><p class="ui-state__title">${ledger.scope === "own" ? "No movements of yours yet" : "Nothing moved yet"}</p><p class="ui-state__why">${why}</p></div>`;
  }
  const rows = ledger.rows.map((r) => `
    <tr>
      <td data-label="Time">${bureauTime(r.at)}</td>
      <td data-label="Corporation">${escapeHtml(r.corpName || (r.by === "bureau" ? "The Bureau" : "—"))}</td>
      <td data-label="Entry">${kindLabel(r.kind)}${r.note ? `<span class="cong-ledger__note">${escapeHtml(r.note)}</span>` : ""}</td>
      ${goods ? `<td data-label="Item">${escapeHtml(r.item)}</td>` : ""}
      <td data-label="${goods ? "Units" : "Credits"}" class="ui-table__num cong-ledger__amount${r.amount < 0 ? " cong-ledger__amount--out" : r.amount > 0 ? " cong-ledger__amount--in" : ""}">${signed(r.amount)}</td>
      <td data-label="${goods ? "Stock after" : "Balance after"}" class="ui-table__num">${n(r.balanceAfter)}</td>
    </tr>`).join("");
  const first = ledger.offset + 1, last = ledger.offset + ledger.rows.length;
  const newer = ledger.offset > 0, older = last < ledger.total;
  return `
    <p class="cong-panel__lede">${scope}</p>
    <div class="ui-table-wrap"><table class="ui-table cong-ledger">
      <caption class="ui-table__caption">Rows ${n(first)} to ${n(last)} of ${n(ledger.total)}, newest first</caption>
      <thead><tr><th scope="col">Time</th><th scope="col">Corporation</th><th scope="col">Entry</th>${goods ? '<th scope="col">Item</th>' : ""}<th scope="col" class="ui-table__num">${goods ? "Units" : "Credits"}</th><th scope="col" class="ui-table__num">${goods ? "Stock after" : "Balance after"}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="cong-actions cong-pager">
      <button type="button" class="ui-button ui-button--secondary" data-role="cong-ledger-page" data-which="${which}" data-offset="${Math.max(0, ledger.offset - ledger.limit)}"${newer ? "" : " disabled"}>Newer</button>
      <button type="button" class="ui-button ui-button--secondary" data-role="cong-ledger-page" data-which="${which}" data-offset="${ledger.offset + ledger.limit}"${older ? "" : " disabled"}>Older</button>
    </div>`;
}



/** The Treasury screen. `t` is GET .../treasury; `may` the caller's permissions; `status` a line per form. */
export function treasuryHtml(t, { may = [], status = {}, form = {} } = {}) {
  if (!t) return `<p class="station__note">Reading the treasury…</p>`;
  if (t.error) return `<div class="ui-state ui-state--error" role="alert"><p class="ui-state__title">The treasury could not be loaded</p><p class="ui-state__why">${escapeHtml(t.error)} Nothing has changed.</p><button type="button" class="ui-button ui-button--secondary" data-role="cong-reload">Try again</button></div>`;
  const a = t.allowance;
  const noticeAt = Math.floor((t.balance * (t.noticePct ?? 10)) / 100);
  const arrears = t.arrears ? `<p class="cong-refusal" role="alert">In arrears: ${n(t.arrears.owed)} credits of upkeep unpaid since ${bureauTime(t.arrears.since)}. Nobody can be admitted and no level bought until a deposit covers it; after 7 days the conglomerate loses a level.</p>` : "";
  const deposit = may.includes("contribute") ? `
    <form class="cong-money-form" data-role="cong-treasury-deposit" novalidate>
      <div class="ui-field"><label class="ui-field__label" for="cong-deposit-amount">Deposit credits</label>
      <input class="ui-input" id="cong-deposit-amount" name="amount" inputmode="numeric" autocomplete="off" value="${escapeHtml(form.deposit || "")}" aria-describedby="cong-deposit-hint">
      <span class="ui-field__hint" id="cong-deposit-hint">The ISA keeps a ${n(t.custodyFeePct)}% custody fee. Money in the treasury is the conglomerate's: members cannot take credits back.</span></div>
      <button type="submit" class="ui-button ui-button--primary">Deposit</button>
      ${statusLine("cong-treasury-deposit-status", status.deposit)}
    </form>` : "";
  const withdraw = a ? `
    <form class="cong-money-form" data-role="cong-treasury-withdraw" novalidate>
      <p class="cong-allowance" data-role="cong-treasury-allowance">You may withdraw <strong>${n(a.remaining)}</strong> more credits today, of ${n(a.cap)} (${a.cap ? `your role's share of the ${n(a.opening)} the treasury held at 00:00 UTC` : "the treasury held nothing at 00:00 UTC"}). It resets at 00:00 UTC.</p>
      <div class="ui-field"><label class="ui-field__label" for="cong-withdraw-amount">Withdraw credits</label>
      <input class="ui-input" id="cong-withdraw-amount" name="amount" inputmode="numeric" autocomplete="off" value="${escapeHtml(form.withdraw || "")}" aria-describedby="cong-withdraw-hint"${a.remaining ? "" : " disabled"}>
      <span class="ui-field__hint" id="cong-withdraw-hint">More than ${n(noticeAt)} (10% of the balance) is announced to every member and paid after 24 hours, unless two directors block it.</span></div>
      <button type="submit" class="ui-button ui-button--secondary"${a.remaining ? "" : ' disabled aria-describedby="cong-withdraw-none"'}>Withdraw</button>
      ${a.remaining ? "" : `<p class="cong-item__why" id="cong-withdraw-none">Nothing more can be withdrawn today. The allowance resets at 00:00 UTC.</p>`}
      ${statusLine("cong-treasury-withdraw-status", status.withdraw)}
    </form>` : `<p class="cong-panel__lede">Members deposit; the founder and directors withdraw, within a daily cap.</p>`;
  const pending = t.pending.length ? `<h4 class="cong-subhead">Announced withdrawals</h4><ul class="cong-list">${t.pending.map((w) => `
    <li class="ui-card cong-item"><div class="cong-item__text"><p class="ui-card__title">${escapeHtml(w.corpName || "A corporation")}: ${n(w.amount)} credits</p><p class="ui-card__meta">Paid ${bureauTime(w.completesAt)} unless blocked${w.blockedBy.length ? ` · ${w.blockedBy.length} block so far` : ""}</p></div>
    <div class="cong-actions">${may.includes("block-withdrawal") && w.corp !== t.me ? `<button type="button" class="ui-button ui-button--danger" data-role="cong-withdrawal-block" data-withdrawal="${escapeHtml(w.id)}">Block</button>` : ""}</div></li>`).join("")}</ul>` : "";
  return `
    <section class="ui-panel station__panel cong-panel" data-role="cong-treasury">
      <h3>${codeSlotHtml("cong-treasury")}Treasury</h3>
      <dl class="ui-kv cong-terms">
        <dt>Balance</dt><dd data-role="cong-treasury-balance">${n(t.balance)} credits</dd>
        <dt>Upkeep</dt><dd>${n(t.upkeepPerDay)} credits a day, next at ${bureauTime(t.nextUpkeepAt)}</dd>
      </dl>
      ${arrears}
      <div class="cong-money">${deposit}${withdraw}</div>
      ${pending}
    </section>
    <section class="ui-panel station__panel cong-panel" data-role="cong-treasury-ledger">
      <h3>${codeSlotHtml("cong-treasury-ledger")}Ledger</h3>
      ${ledgerHtml(t.ledger, { which: "treasury" })}
    </section>`;
}

/** The Hangar screen. `h` is GET .../hangar; `own` the caller's stock at the hangar's station ({ item: units }). */
export function hangarHtml(h, { may = [], own = {}, status = {}, docked = false } = {}) {
  if (!h) return `<p class="station__note">Reading the hangar…</p>`;
  if (h.error) return `<div class="ui-state ui-state--error" role="alert"><p class="ui-state__title">The hangar could not be loaded</p><p class="ui-state__why">${escapeHtml(h.error)} Nothing has changed.</p><button type="button" class="ui-button ui-button--secondary" data-role="cong-reload">Try again</button></div>`;
  const held = Object.entries(h.items).sort(([a], [b]) => a.localeCompare(b));
  const stock = held.length ? `<div class="ui-table-wrap"><table class="ui-table cong-stock">
      <caption class="ui-table__caption">At ${escapeHtml(h.stationName)}</caption>
      <thead><tr><th scope="col">Item</th><th scope="col" class="ui-table__num">In the hangar</th><th scope="col" class="ui-table__num">You may take today</th></tr></thead>
      <tbody>${held.map(([item, units]) => `<tr><td data-label="Item">${escapeHtml(item)}</td><td data-label="In the hangar" class="ui-table__num">${n(units)}</td><td data-label="You may take today" class="ui-table__num">${n(h.allowance[item]?.remaining)}</td></tr>`).join("")}</tbody>
    </table></div>` : `<div class="ui-state" role="status"><p class="ui-state__title">The hangar is empty</p><p class="ui-state__why">Deposit goods your corporation holds at ${escapeHtml(h.stationName)} and every member can draw on them within their daily share.</p></div>`;
  const ownItems = Object.entries(own).filter(([, q]) => Number(q) > 0).sort(([a], [b]) => a.localeCompare(b));
  const here = docked || ownItems.length > 0;
  const away = `<p class="cong-item__why">Goods move between your own stock at ${escapeHtml(h.stationName)} and the hangar. Dock there, or ship goods there, first.</p>`;
  const deposit = may.includes("contribute") ? (here && ownItems.length ? `
    <form class="cong-money-form" data-role="cong-hangar-deposit" novalidate>
      <div class="ui-field"><label class="ui-field__label" for="cong-goods-in-item">Deposit goods</label>
      <select class="ui-select" id="cong-goods-in-item" name="item">${ownItems.map(([item, q]) => `<option value="${escapeHtml(item)}">${escapeHtml(item)} (you hold ${n(q)})</option>`).join("")}</select></div>
      <div class="ui-field"><label class="ui-field__label" for="cong-goods-in-qty">Units</label><input class="ui-input" id="cong-goods-in-qty" name="quantity" inputmode="numeric" autocomplete="off"></div>
      <button type="submit" class="ui-button ui-button--primary">Deposit</button>
      ${statusLine("cong-hangar-deposit-status", status.deposit)}
    </form>` : here ? `<p class="cong-panel__lede">Your corporation holds no goods at ${escapeHtml(h.stationName)} to deposit.</p>` : away) : "";
  const takeable = held.filter(([item]) => (h.allowance[item]?.remaining || 0) > 0);
  const withdraw = may.includes("withdraw-goods") ? (!here ? "" : takeable.length ? `
    <form class="cong-money-form" data-role="cong-hangar-withdraw" novalidate>
      <div class="ui-field"><label class="ui-field__label" for="cong-goods-out-item">Withdraw goods</label>
      <select class="ui-select" id="cong-goods-out-item" name="item">${takeable.map(([item]) => `<option value="${escapeHtml(item)}">${escapeHtml(item)} (up to ${n(h.allowance[item].remaining)} today)</option>`).join("")}</select></div>
      <div class="ui-field"><label class="ui-field__label" for="cong-goods-out-qty">Units</label><input class="ui-input" id="cong-goods-out-qty" name="quantity" inputmode="numeric" autocomplete="off"></div>
      <button type="submit" class="ui-button ui-button--secondary">Withdraw</button>
      ${statusLine("cong-hangar-withdraw-status", status.withdraw)}
    </form>` : held.length ? `<p class="cong-item__why">Nothing more can be withdrawn today: each role takes a share of each item's stock at 00:00 UTC, and the share resets then.</p>` : "") : "";
  return `
    <section class="ui-panel station__panel cong-panel" data-role="cong-hangar">
      <h3>${codeSlotHtml("cong-hangar")}Hangar</h3>
      ${stock}
      <div class="cong-money">${deposit}${withdraw}</div>
    </section>
    <section class="ui-panel station__panel cong-panel" data-role="cong-hangar-ledger">
      <h3>${codeSlotHtml("cong-hangar-ledger")}Ledger</h3>
      ${ledgerHtml(h.ledger, { which: "hangar", goods: true })}
    </section>`;
}

// ISP-213 (AB#908): the Conglomerate tab's Station screen, as HTML. Pure: no DOM and no requests, so node tests read
// it; views/conglomerateBureau.js fetches, binds and draws what this returns.
//
// Three states, each from the server's own reads (GET .../station-project and GET .../station):
// - no station yet: where one could be built and what it costs, and for the founder the form that files it;
// - a project: the bill of materials with what is in and what is still needed, each input's bar, the ways to fund it
//   (a member's own stock; the founder's pool), who has put in what, and the build clock once it is funded;
// - the station: its body's art (ISP-78's), the stakes, what a member gets there, and the stake vote.
// Every figure is the server's; nothing here computes a share, a price or a result the server has not sent.

import { escapeHtml } from "./html.js";
import { bureauTime } from "./conglomerateBureau.js";
import { stationArtHtml } from "./stationArt.js";
import { codeSlotHtml } from "./sectionCodes.js"; // ISP-250 (AB#946): the drawn sections' document codes
import { protocolLineHtml } from "./protocol.js"; // ISP-254 (AB#4821)

const n = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
const pct = (have, need) => (need > 0 ? Math.min(100, (100 * have) / need) : 100);
// ISP-254 (AB#4821): the plain words, then the protocol line when the line carries one (public/scripts/protocol.js)
const statusLine = (role, s) => `<p class="cong-form-status${s?.ok ? " cong-form-status--ok" : ""}" data-role="${role}" role="status">${escapeHtml(s?.text || "")}${s?.text && s?.protocol ? ` ${protocolLineHtml(s.protocol)}` : ""}</p>`;
const unsuccessful = () => protocolLineHtml({ meaning: "failed", screen: "conglomerate" }); // read at draw time: the codes load after this module
const bar = (label, value) => `<div class="progress-wrap cong-station__bar" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}"><div class="progress-bar${value >= 100 ? " is-complete" : ""}" style="width:${value.toFixed(1)}%"></div></div>`;
export const ACCESS_LABELS = { open: "Every corporation", members: "Members only", "members-and-listed": "Members and listed conglomerates" };

/** The art for a station or a project's site: the body it orbits, drawn as every station's header draws it. */
const artFor = (site, systems) => stationArtHtml({ systemId: site.systemId, body: site.body, name: site.name }, systems);
const systemName = (systems, id) => (systems || []).find((s) => s.id === id)?.name || id;

/** The whole Station screen. `sp` is GET .../station-project, `gov` GET .../station (null before it is built). */
export function stationTabHtml(sp, gov, ctx = {}) {
  if (!sp) return `<p class="station__note">Reading the station project…</p>`;
  if (sp.error) return `<div class="ui-state ui-state--error" role="alert"><p class="ui-state__title">The station could not be loaded</p><p class="ui-state__why">${escapeHtml(sp.error)} Nothing has changed. ${unsuccessful()}</p><button type="button" class="ui-button ui-button--secondary" data-role="cong-reload">Try again</button></div>`;
  // Bug #4669: the member rate from this screen's own read, which a membership read from before the station opened lacks
  if (sp.station && gov) return coOwnedStationHtml(gov, { ...ctx, memberRentPct: sp.memberRentPct });
  if (sp.project) return projectHtml(sp.project, ctx);
  return noStationHtml(sp, ctx);
}

/** No station and no project: where one could go and what it costs; the founder's form to file it. */
export function noStationHtml(sp, { may = [], level = 0, atBureau = false, systems = [], status = {} } = {}) {
  const founder = may.includes("station-project");
  const cost = sp.bill ? billSummary(sp.bill) : "";
  let body;
  if (!sp.canStart) {
    body = level < sp.minLevel
      ? `<p class="cong-panel__lede">A station project needs a level ${n(sp.minLevel)} conglomerate; yours is level ${n(level)}. Levels are bought at the Bureau as the roster grows.</p>`
      : `<p class="cong-panel__lede">A station project cannot be filed now: the conglomerate must owe no upkeep and have no other project open.</p>`;
  } else if (!sp.openOrbits.length) {
    body = `<p class="cong-panel__lede">No open orbit is in reach. A station is built at a body with no station, in a system where a member holds a mining lease: lease a claim in another system first.</p>`;
  } else if (!founder) {
    body = `<p class="cong-panel__lede">The founder files a station project at the Bureau. Once it is filed, every member can fund it from here, and what you put in becomes your stake.</p>
      <ul class="cong-station__sites">${sp.openOrbits.map((o) => `<li>${escapeHtml(o.body)}, ${escapeHtml(o.systemName)}</li>`).join("")}</ul>`;
  } else {
    body = `
      <form class="cong-station__start" data-role="cong-station-start" novalidate>
        <div class="ui-field"><label class="ui-field__label" for="cong-station-site">Where</label>
          <select class="ui-select" id="cong-station-site" name="site">${sp.openOrbits.map((o) => `<option value="${escapeHtml(`${o.systemId}|${o.body}`)}">${escapeHtml(o.body)}, ${escapeHtml(o.systemName)}</option>`).join("")}</select>
          <span class="ui-field__hint">An open orbit in a system where a member mines.</span></div>
        <div class="ui-field"><label class="ui-field__label" for="cong-station-name">Name</label>
          <select class="ui-select" id="cong-station-name" name="suffix">${sp.nameSuffixes.map((s, i) => `<option value="${i + 1}">${escapeHtml(s)}</option>`).join("")}</select>
          <span class="ui-field__hint">The station is named after its body: for example, "${escapeHtml(sp.openOrbits[0].body)} ${escapeHtml(sp.nameSuffixes[0])}".</span></div>
        <button type="submit" class="ui-button ui-button--primary"${atBureau ? "" : ' aria-describedby="cong-station-away"'}>File the station project</button>
        ${atBureau ? "" : `<p class="cong-item__why" id="cong-station-away">Projects are filed at the Conglomerate Affairs Bureau on Earth Station Prime; travel there to file it.</p>`}
        ${statusLine("cong-station-start-status", status.start)}
      </form>`;
  }
  return `
    <section class="ui-panel station__panel cong-panel cong-station" data-role="cong-station-none">
      <h3>${codeSlotHtml("cong-station-none")}A station of your own</h3>
      <p class="cong-panel__lede">A conglomerate can build a station. Members fund it together, each contribution becomes that corporation's stake, and the stakes govern it. Members rent offices there at ${n(sp.memberRentPct)}% and move goods within its system for nothing.</p>
      <dl class="ui-kv cong-terms"><dt>It costs</dt><dd>${cost}</dd><dt>It takes</dt><dd>${n(sp.buildDays)} days to build once fully funded</dd><dt>It needs</dt><dd>A level ${n(sp.minLevel)} conglomerate</dd></dl>
      ${body}
    </section>`;
}

function billSummary(bill) {
  return [`${n(bill.credits)} credits`, ...Object.entries(bill.goods).map(([item, q]) => `${n(q)} ${escapeHtml(item)}`)].join(", ");
}

/** A project in funding or under construction. */
export function projectHtml(p, { may = [], systems = [], own = {}, hangar = {}, treasury = null, status = {}, now = Date.now(), me = null } = {}) {
  const founder = may.includes("station-project");
  const lines = [["Credits", p.needs.credits, p.has.credits, p.remaining.credits], ...Object.entries(p.needs.goods).map(([item, need]) => [item, need, p.has.goods[item] || 0, p.remaining.goods[item]])];
  const table = `<div class="ui-table-wrap"><table class="ui-table cong-station__bill">
      <caption class="ui-table__caption">Bill of materials</caption>
      <thead><tr><th scope="col">Input</th><th scope="col" class="ui-table__num">Needed</th><th scope="col" class="ui-table__num">In</th><th scope="col" class="ui-table__num">Still needed</th><th scope="col">Progress</th></tr></thead>
      <tbody>${lines.map(([label, need, have, left]) => `<tr data-role="cong-station-line" data-input="${escapeHtml(label)}"><td data-label="Input">${escapeHtml(label)}</td><td data-label="Needed" class="ui-table__num">${n(need)}</td><td data-label="In" class="ui-table__num">${n(have)}</td><td data-label="Still needed" class="ui-table__num">${n(left)}</td><td data-label="Progress">${bar(`${label}: ${n(have)} of ${n(need)}`, pct(have, need))}</td></tr>`).join("")}</tbody>
    </table></div>`;
  let state;
  if (p.state === "building") {
    const total = p.completesAt - p.fundedAt;
    state = `<div class="cong-station__clock" data-role="cong-station-clock"><p class="cong-panel__lede"><strong>Fully funded.</strong> Construction began ${bureauTime(p.fundedAt)}; ${escapeHtml(p.name)} opens ${bureauTime(p.completesAt)}.</p>${bar("Construction", pct(now - p.fundedAt, total))}${p.blocked ? `<p class="cong-refusal" role="alert">Construction is held: ${escapeHtml(p.blocked)}. Nothing has been created.</p>` : ""}</div>`;
  } else {
    const needGoods = Object.entries(p.remaining.goods).filter(([, left]) => left > 0);
    const ownGoods = needGoods.filter(([item]) => Number(own[item]) > 0);
    const poolGoods = needGoods.filter(([item]) => Number(hangar[item]) > 0);
    const ownForm = may.includes("contribute") ? `
      <form class="cong-money-form" data-role="cong-station-give" data-source="own" novalidate>
        <h4 class="cong-subhead">From your corporation</h4>
        <p class="cong-station__note">What you put in is your stake: it decides your vote on the station, and what you are paid out if you leave.</p>
        ${p.remaining.credits > 0 ? `<div class="ui-field"><label class="ui-field__label" for="cong-give-credits">Credits</label><input class="ui-input" id="cong-give-credits" name="credits" inputmode="numeric" autocomplete="off" placeholder="up to ${n(p.remaining.credits)}"></div>` : `<p class="cong-station__note">The credits are all in; goods are still needed.</p>`}
        ${ownGoods.length ? `<div class="ui-field"><label class="ui-field__label" for="cong-give-item">Or goods, from your stock at the hangar's station</label>
          <select class="ui-select" id="cong-give-item" name="item"><option value="">No goods</option>${ownGoods.map(([item, left]) => `<option value="${escapeHtml(item)}">${escapeHtml(item)} (you hold ${n(own[item])}; ${n(left)} needed)</option>`).join("")}</select></div>
          <div class="ui-field"><label class="ui-field__label" for="cong-give-qty">Units</label><input class="ui-input" id="cong-give-qty" name="quantity" inputmode="numeric" autocomplete="off"></div>`
        : needGoods.length ? `<p class="cong-item__why">Your corporation holds none of the goods still needed at the hangar's station.</p>` : ""}
        <button type="submit" class="ui-button ui-button--primary">Put it in</button>
        ${statusLine("cong-station-give-own-status", status.own)}
      </form>` : "";
    const poolHasSome = p.remaining.credits > 0 || poolGoods.length > 0;
    const poolForm = founder && !poolHasSome ? `<div class="cong-money-form"><h4 class="cong-subhead">From the pool</h4><p class="cong-station__note">The hangar holds none of the goods still needed, and the credits are all in.</p></div>` : founder ? `
      <form class="cong-money-form" data-role="cong-station-give" data-source="pool" novalidate>
        <h4 class="cong-subhead">From the pool</h4>
        <p class="cong-station__note">The treasury's credits and the hangar's goods are everyone's, so they add to the station but to nobody's stake.</p>
        ${p.remaining.credits > 0 ? `<div class="ui-field"><label class="ui-field__label" for="cong-pool-credits">Treasury credits${treasury ? ` (it holds ${n(treasury.credits)})` : ""}</label><input class="ui-input" id="cong-pool-credits" name="credits" inputmode="numeric" autocomplete="off"></div>` : ""}
        ${poolGoods.length ? `<div class="ui-field"><label class="ui-field__label" for="cong-pool-item">Or hangar goods</label>
          <select class="ui-select" id="cong-pool-item" name="item"><option value="">No goods</option>${poolGoods.map(([item, left]) => `<option value="${escapeHtml(item)}">${escapeHtml(item)} (the hangar holds ${n(hangar[item])}; ${n(left)} needed)</option>`).join("")}</select></div>
          <div class="ui-field"><label class="ui-field__label" for="cong-pool-qty">Units</label><input class="ui-input" id="cong-pool-qty" name="quantity" inputmode="numeric" autocomplete="off"></div>` : ""}
        <button type="submit" class="ui-button ui-button--secondary">Move it in</button>
        ${statusLine("cong-station-give-pool-status", status.pool)}
      </form>` : "";
    state = `<div class="cong-money">${ownForm}${poolForm}</div>`;
  }
  const pooled = p.contributions.filter((r) => !r.corp).reduce((s, r) => s + r.value, 0);
  const who = p.byMember.length || pooled ? `<ul class="cong-list" data-role="cong-station-contributors">
      ${p.byMember.map((m) => `<li class="ui-card cong-item"><div class="cong-item__text"><p class="ui-card__title">${escapeHtml(m.corpName || "A corporation")}${m.corp === me ? " (you)" : ""}</p><p class="ui-card__meta">${n(m.value)} credits of value put in</p></div></li>`).join("")}
      ${pooled ? `<li class="ui-card cong-item"><div class="cong-item__text"><p class="ui-card__title">The pool</p><p class="ui-card__meta">${n(pooled)} credits of value from the treasury and hangar, nobody's stake</p></div></li>` : ""}
    </ul>` : `<div class="ui-state" role="status"><p class="ui-state__title">Nothing put in yet</p><p class="ui-state__why">The first contribution appears here, with who made it.</p></div>`;
  return `
    <section class="ui-panel station__panel cong-panel cong-station" data-role="cong-station-project">
      <div class="cong-station__head">${artFor(p, systems)}<div>
        <p class="station__overline">${p.state === "building" ? "Under construction" : "Station project"} · ${escapeHtml(systemName(systems, p.systemId))} ${protocolLineHtml({ meaning: p.state === "building" ? "active" : "queued", screen: "conglomerate" })}</p>
        <h3>${codeSlotHtml("cong-station-project")}${escapeHtml(p.name)}</h3>
        <p class="cong-panel__lede">In orbit of ${escapeHtml(p.body)}. Filed ${bureauTime(p.startedAt)}.</p>
      </div></div>
      ${table}
      ${state}
      ${founder && p.state === "funding" ? `<button type="button" class="ui-button ui-button--danger" data-role="cong-station-cancel">Cancel the project</button>${statusLine("cong-station-cancel-status", status.cancel)}` : ""}
    </section>
    <section class="ui-panel station__panel cong-panel" data-role="cong-station-contributions">
      <h3>${codeSlotHtml("cong-station-contributions")}Who has put in</h3>
      ${who}
    </section>`;
}

/** The built station: art, stakes, what a member gets there, and the stake vote. */
export function coOwnedStationHtml(gov, { may = [], me = null, systems = [], stations = [], memberStation = null, memberRentPct = null, directory = [], standardRent = 0, conglomerateId = null, status = {} } = {}) {
  const st = stations.find((s) => s.id === gov.station.id) || gov.station;
  const mine = gov.stakes.find((s) => s.corp === me);
  const stakes = gov.stakes.length ? `<div class="ui-table-wrap"><table class="ui-table cong-station__stakes">
      <caption class="ui-table__caption">Stakes, from what each corporation put in</caption>
      <thead><tr><th scope="col">Corporation</th><th scope="col" class="ui-table__num">Stake</th><th scope="col" class="ui-table__num">Put in</th></tr></thead>
      <tbody>${gov.stakes.map((s) => `<tr data-role="cong-stake" data-corp="${escapeHtml(s.corp)}"><td data-label="Corporation">${escapeHtml(s.corpName || "A corporation")}${s.corp === me ? " (you)" : ""}</td><td data-label="Stake" class="ui-table__num">${s.pct.toFixed(2)}%</td><td data-label="Put in" class="ui-table__num">${n(s.value)}</td></tr>`).join("")}</tbody>
    </table></div>` : `<p class="cong-panel__lede">Nobody holds a stake: the station was built from the pool, so the founder decides its settings.</p>`;
  const rate = memberRentPct ?? memberStation?.officeRentPct ?? null; // Bug #4669: the screen's fresh read first
  const benefits = `<ul class="cong-station__benefits" data-role="cong-station-benefits">
      ${rate === null ? "" : `<li><strong>Offices at ${n(rate)}%.</strong> A member's suite here costs ${n((standardRent * rate) / 100)} credits a day, not ${n(standardRent)}: lease or renew it in the Orbital Executive Suites once docked.</li>`}
      <li><strong>Free logistics in ${escapeHtml(systemName(systems, st.systemId))}.</strong> Goods move between ${escapeHtml(st.name)} and any other station in the system for nothing.</li>
      ${Number.isFinite(gov.settings.taxPct) ? `<li><strong>No sales tax for members.</strong> A member's sale on the exchange here pays nothing; anyone else pays ${n(gov.settings.taxPct)}%, to the treasury.</li>` : ""}
    </ul>`;
  const open = gov.proposals.filter((p) => p.state === "open");
  const closed = gov.proposals.filter((p) => p.state !== "open").slice(0, 5);
  const voteRow = (p) => {
    const voted = p.votes.find((v) => v.corp === me);
    const canVote = mine && !voted;
    return `<li class="ui-card cong-item" data-role="cong-proposal" data-proposal="${escapeHtml(p.id)}">
      <div class="cong-item__text"><p class="ui-card__title">${escapeHtml(p.text)}</p>
        <p class="ui-card__meta">Proposed by ${escapeHtml(p.proposedByName || "a corporation")} · closes ${bureauTime(p.closesAt)} · yes ${p.yesPct ?? "—"}%, no ${p.noPct ?? "—"}% of all stake ${protocolLineHtml({ meaning: "pending", screen: "conglomerate" })}</p>
        ${bar(`Yes: ${p.yesPct ?? 0}% of all stake; it passes above 50%`, p.yesPct || 0).replace("cong-station__bar", "cong-station__bar cong-station__votebar")}
        <p class="cong-station__note">It passes when yes is more than 50% of all stake (the line).</p>
        ${voted ? `<p class="cong-station__note">You voted ${escapeHtml(voted.vote)}.</p>` : mine ? "" : `<p class="cong-station__note">Only corporations with a stake vote.</p>`}</div>
      ${canVote ? `<div class="cong-actions"><button type="button" class="ui-button ui-button--primary" data-role="cong-vote" data-vote="yes" data-proposal="${escapeHtml(p.id)}">Vote yes</button><button type="button" class="ui-button ui-button--secondary" data-role="cong-vote" data-vote="no" data-proposal="${escapeHtml(p.id)}">Vote no</button></div>` : ""}
    </li>`;
  };
  const others = directory.filter((c) => c.id !== conglomerateId);
  const listed = gov.settings.listed.map((l) => l.id);
  const propose = may.includes("propose-station-setting") ? `
    <form class="cong-money-form" data-role="cong-propose" novalidate>
      <h4 class="cong-subhead">Propose a change</h4>
      <div class="ui-field"><label class="ui-field__label" for="cong-propose-what">Change</label>
        <select class="ui-select" id="cong-propose-what" name="what">
          ${Object.entries(ACCESS_LABELS).filter(([id]) => id !== gov.settings.access).map(([id, label]) => `<option value="access|${id}">Docking: ${escapeHtml(label)}</option>`).join("")}
          ${others.filter((c) => !listed.includes(c.id)).map((c) => `<option value="list|${escapeHtml(c.id)}">List ${escapeHtml(c.name)}</option>`).join("")}
          ${gov.settings.listed.map((c) => `<option value="unlist|${escapeHtml(c.id)}">Unlist ${escapeHtml(c.name)}</option>`).join("")}
          ${(gov.settings.taxOptions || []).filter((pct) => pct !== gov.settings.taxPct).map((pct) => `<option value="tax|${n(pct)}">Sales tax for non-members: ${n(pct)}%</option>`).join("")}
        </select>
        <span class="ui-field__hint">It passes when more than half of all stake votes yes${mine ? "; your own stake counts as a yes" : ""}, and lapses after 72 hours.</span></div>
      <button type="submit" class="ui-button ui-button--primary">Put it to the vote</button>
      ${statusLine("cong-propose-status", status.propose)}
    </form>` : "";
  const buyouts = gov.buyouts.length ? `<h4 class="cong-subhead">Stakes being bought out</h4><ul class="cong-list">${gov.buyouts.map((b) => `<li class="ui-card cong-item"><div class="cong-item__text"><p class="ui-card__title">${escapeHtml(b.corpName || "A former member")}: ${n(b.paid)} of ${n(b.total)} credits paid</p><p class="ui-card__meta">${b.how === "removed" ? "Removed: its whole stake" : "Left: half its stake"}, over ${n(b.days)} days from ${bureauTime(b.startsAt)}</p></div></li>`).join("")}</ul>` : "";
  return `
    <section class="ui-panel station__panel cong-panel cong-station" data-role="cong-station-built">
      <div class="cong-station__head">${stationArtHtml(st, systems)}<div>
        <p class="station__overline">${escapeHtml(st.designation || "")} · ${escapeHtml(systemName(systems, st.systemId))}</p>
        <h3>${codeSlotHtml("cong-station-built")}${escapeHtml(st.name)}</h3>
        <p class="cong-panel__lede">In orbit of ${escapeHtml(st.body)}. Built ${bureauTime(gov.station.builtAt)} and owned by your conglomerate.${mine ? ` Your stake: <strong>${mine.pct.toFixed(2)}%</strong>.` : ""}</p>
      </div></div>
      <h4 class="cong-subhead">What members get here</h4>
      ${benefits}
    </section>
    <section class="ui-panel station__panel cong-panel" data-role="cong-station-stakes">
      <h3>${codeSlotHtml("cong-station-stakes")}Stakes</h3>
      ${stakes}
      ${buyouts}
    </section>
    <section class="ui-panel station__panel cong-panel" data-role="cong-station-governance">
      <h3>${codeSlotHtml("cong-station-governance")}Governance</h3>
      <dl class="ui-kv cong-terms"><dt>Who may dock</dt><dd data-role="cong-station-access">${escapeHtml(ACCESS_LABELS[gov.settings.access] || gov.settings.access)}</dd>
        <dt>Listed</dt><dd>${gov.settings.listed.length ? gov.settings.listed.map((l) => escapeHtml(l.name)).join(", ") : "None"}</dd>
        ${Number.isFinite(gov.settings.taxPct) ? `<dt>Sales tax</dt><dd data-role="cong-station-tax">${n(gov.settings.taxPct)}% for non-members, to the treasury; members pay none</dd>` : ""}</dl>
      ${open.length ? `<h4 class="cong-subhead">Open votes</h4><ul class="cong-list">${open.map(voteRow).join("")}</ul>` : `<p class="cong-panel__lede">No vote is open.</p>`}
      ${statusLine("cong-vote-status", status.vote)}
      ${propose}
      ${closed.length ? `<h4 class="cong-subhead">Recent votes</h4><ul class="cong-list">${closed.map((p) => `<li class="ui-card cong-item"><div class="cong-item__text"><p class="ui-card__title">${escapeHtml(p.text)}</p><p class="ui-card__meta">${p.state === "passed" ? "Passed" : p.state === "expired" ? "Lapsed" : "Voted down"} ${bureauTime(p.closedAt)}${p.state === "expired" ? "" : ` ${protocolLineHtml({ meaning: p.state === "passed" ? "active" : "refused", screen: "conglomerate" })}`}</p></div></li>`).join("")}</ul>` : ""}
    </section>`;
}

/** ISP-213 (AB#908): the Station tab's panel when a member is docked at its own conglomerate's station. */
export function dockedAtOwnStationHtml(station, { memberStation, standardRent, systems = [] } = {}) {
  return `
    <section class="ui-panel station__panel cong-station__docked" data-role="own-station-panel">
      <h3>${codeSlotHtml("own-station-panel")}Your conglomerate's station</h3>
      <p class="station__note">${escapeHtml(station.name)} belongs to your conglomerate. As a member, your suite here costs ${n((standardRent * memberStation.officeRentPct) / 100)} credits a day (${n(memberStation.officeRentPct)}% of ${n(standardRent)}), and goods move between here and the rest of ${escapeHtml(systemName(systems, station.systemId))} for nothing.</p>
      <button type="button" class="ui-button ui-button--secondary" data-role="own-station-open">Stakes and votes</button>
    </section>`;
}

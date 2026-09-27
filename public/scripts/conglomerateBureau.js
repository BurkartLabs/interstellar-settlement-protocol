// ISP-200 (AB#894): the Conglomerate Affairs Bureau's view, as HTML. Pure: no DOM and no requests, so node tests read
// it. views/conglomerateBureau.js fetches, binds and draws what this returns.
//
// Everything decided here is the server's: whether a charter can be filed (view.charter.refusal, the route's own
// words), what the caller's role may do (view.conglomerate.permissions, from can()), and every figure. A control the
// server would refuse is drawn disabled with the reason beside it, never as a button that does nothing.

import { escapeHtml } from "./html.js";

const n = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");

/** The Bureau's twelve emblems: [name, SVG path in a 24-unit box]. */
export const EMBLEMS = [
  ["Circle", "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z"],
  ["Square", "M4 4h16v16H4z"],
  ["Diamond", "M12 2l10 10-10 10L2 12z"],
  ["Triangle", "M12 3l10 18H2z"],
  ["Hexagon", "M7 3h10l5 9-5 9H7l-5-9z"],
  ["Star", "M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5-6.5 4.5 2-7.5L2 9h7z"],
  ["Cross", "M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"],
  ["Chevron", "M2 6l10 6 10-6v6l-10 6-10-6z"],
  ["Ring", "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm0 5a5 5 0 1 1 0 10a5 5 0 1 1 0-10z"],
  ["Shield", "M12 2l9 3v6c0 6-4 10-9 11-5-1-9-5-9-11V5z"],
  ["Arrowhead", "M12 2l8 20-8-5-8 5z"],
  ["Octagon", "M8 2h8l6 6v8l-6 6H8l-6-6V8z"]
];
/** The Bureau's ten colours, each a design-system tone (styles.css .cong-colour--N). */
export const COLOURS = ["Cyan", "Deep cyan", "Green", "Deep green", "Amber", "Deep amber", "Rose", "Deep rose", "White", "Grey"];

/** A conglomerate's emblem in its colour, labelled for assistive technology. */
export function emblemSvg(emblem, colour, { size = "md" } = {}) {
  const [name, d] = EMBLEMS[(Number(emblem) || 1) - 1] || EMBLEMS[0];
  const tone = COLOURS[(Number(colour) || 1) - 1] ? Number(colour) : 1;
  return `<svg class="cong-emblem cong-emblem--${size} cong-colour--${tone}" viewBox="0 0 24 24" role="img" aria-label="${escapeHtml(`${COLOURS[tone - 1]} ${name.toLowerCase()} emblem`)}"><path fill-rule="evenodd" d="${d}"/></svg>`;
}

/** A time as the Bureau's register writes it: "28 Sep 2026, 14:05 UTC". Fixed names, so every browser and test agrees. */
export function bureauTime(t) {
  const d = new Date(t);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

const button = (role, label, { variant = "secondary", data = {}, disabled = false, describedBy = "" } = {}) =>
  `<button type="button" class="ui-button ui-button--${variant}" data-role="${role}"${Object.entries(data).map(([k, v]) => ` data-${k}="${escapeHtml(String(v))}"`).join("")}${disabled ? " disabled" : ""}${describedBy ? ` aria-describedby="${describedBy}"` : ""}>${escapeHtml(label)}</button>`;

function picker(kind, count, chosen, other) {
  const items = Array.from({ length: count }, (_, i) => i + 1).map((v) => {
    const label = kind === "emblem" ? EMBLEMS[v - 1][0] : COLOURS[v - 1];
    const art = kind === "emblem" ? emblemSvg(v, other, { size: "sm" }) : emblemSvg(1, v, { size: "sm" });
    return `<label class="cong-picker__option"><input type="radio" name="${kind}" value="${v}"${v === chosen ? " checked" : ""}><span class="cong-picker__swatch">${art}</span><span class="cong-picker__name">${escapeHtml(label)}</span></label>`;
  }).join("");
  return `<fieldset class="cong-picker"><legend class="ui-field__label">${kind === "emblem" ? "Emblem" : "Colour"}</legend><div class="cong-picker__grid">${items}</div></fieldset>`;
}

/** The charter form: the price and the requirements before anything is filed, or the server's reason it cannot be. */
export function charterHtml(view, form = {}) {
  if (!view || view.conglomerate) return "";
  const c = view.charter;
  const emblem = form.emblem || 1, colour = form.colour || 1;
  const refusal = c.refusal;
  return `
    <section class="ui-panel station__panel cong-panel" data-role="cong-charter" id="cong-charter">
      <h3>File a conglomerate charter</h3>
      <p class="cong-panel__lede">A conglomerate is a group of corporations under one name, one treasury and one roster. You would be its founder and first member, at level 1 with room for 5.</p>
      <dl class="ui-kv cong-terms">
        <dt>Charter fee</dt><dd>${n(c.fee)} credits, paid to the ISA</dd>
        <dt>Treasury deposit</dt><dd>${n(c.deposit)} credits, into the new treasury for its first upkeep</dd>
        <dt>You pay</dt><dd>${n(c.fee + c.deposit)} credits</dd>
        <dt>Requirements</dt><dd>Registered at least ${n(c.minFounderAgeDays)} days, docked at Earth Station Prime, in no conglomerate</dd>
      </dl>
      <form class="cong-charter-form" data-role="cong-charter-form" novalidate>
        <div class="ui-field">
          <label class="ui-field__label" for="cong-name">Name</label>
          <input class="ui-input" id="cong-name" name="name" maxlength="40" autocomplete="off" value="${escapeHtml(form.name || "")}" aria-describedby="cong-name-hint"${refusal ? " disabled" : ""}>
          <span class="ui-field__hint" id="cong-name-hint">3 to 40 letters, digits, spaces and - ' . &amp;. A conglomerate's name never changes.</span>
        </div>
        ${refusal ? "" : picker("emblem", EMBLEMS.length, emblem, colour) + picker("colour", COLOURS.length, colour, emblem)}
        ${refusal ? `<p class="cong-refusal" id="cong-charter-why" data-code="${escapeHtml(refusal.code)}">${escapeHtml(refusal.error)}</p>` : ""}
        <p class="cong-form-status" data-role="cong-charter-status" role="status"></p>
        <div class="cong-actions">
          <button type="submit" class="ui-button ui-button--primary" data-role="cong-charter-submit"${refusal ? ' disabled aria-describedby="cong-charter-why"' : ""}>Review the charter</button>
        </div>
      </form>
    </section>`;
}

/** The invitations addressed to this corporation, and its open application. */
export function invitationsHtml(view) {
  if (!view || view.conglomerate) return "";
  const items = view.invitations.map((i) => `
    <li class="ui-card cong-item" data-invitation="${escapeHtml(i.id)}">
      ${emblemSvg(i.conglomerate.emblem, i.conglomerate.colour)}
      <div class="cong-item__text">
        <h4 class="ui-card__title">${escapeHtml(i.conglomerate.name)}</h4>
        <p class="ui-card__meta">Level ${n(i.conglomerate.level)} · ${n(i.conglomerate.memberCount)} of ${n(i.conglomerate.maxMembers)} members · invited ${bureauTime(i.at)}</p>
      </div>
      <div class="cong-actions">
        ${button("cong-invitation-accept", "Accept", { variant: "primary", data: { conglomerate: i.conglomerate.id, invitation: i.id } })}
        ${button("cong-invitation-decline", "Decline", { variant: "ghost", data: { conglomerate: i.conglomerate.id, invitation: i.id } })}
      </div>
    </li>`).join("");
  const application = view.application ? `
    <div class="ui-card cong-item" data-role="cong-application">
      ${emblemSvg(view.application.conglomerate.emblem, view.application.conglomerate.colour)}
      <div class="cong-item__text">
        <h4 class="ui-card__title">Your application to ${escapeHtml(view.application.conglomerate.name)}</h4>
        <p class="ui-card__meta">Sent ${bureauTime(view.application.at)}. Its founder or a director answers it; it expires unanswered after 7 days.</p>
      </div>
      <div class="cong-actions">${button("cong-application-withdraw", "Withdraw", { variant: "ghost", data: { conglomerate: view.application.conglomerate.id, application: view.application.id } })}</div>
    </div>` : "";
  const empty = `
    <div class="ui-state" role="status">
      <p class="ui-state__title">No invitations</p>
      <p class="ui-state__why">A conglomerate's founder or directors invite corporations. You can also ask to join one yourself.</p>
      ${button("cong-goto-directory", "Browse conglomerates")}
    </div>`;
  const cooldown = view.joinCooldownUntil ? `<p class="cong-refusal">Your corporation left a conglomerate recently. It can accept an invitation or apply from ${bureauTime(view.joinCooldownUntil)}.</p>` : "";
  return `
    <section class="ui-panel station__panel cong-panel" data-role="cong-invitations">
      <h3>Invitations and applications</h3>
      ${cooldown}
      ${items ? `<ul class="cong-list">${items}</ul>` : empty}
      ${application}
    </section>`;
}

/** Why this corporation cannot apply to `c` now, or "". */
export function applyRefusal(view, c) {
  if (view?.conglomerate?.id === c.id) return "";
  if (view?.conglomerate) return "Your corporation is already in a conglomerate. Leave it to join another.";
  if (view?.application?.conglomerate?.id === c.id) return "You have applied. The founder or a director will answer.";
  if (view?.application) return `You have an open application to ${view.application.conglomerate.name}. Withdraw it to apply here.`;
  if (view?.joinCooldownUntil) return `You can apply from ${bureauTime(view.joinCooldownUntil)}.`;
  return "";
}

/** The directory: every conglomerate with its level, members and cap, and an apply control. */
export function directoryHtml(list, view, { error } = {}) {
  let body;
  if (error) {
    body = `<div class="ui-state ui-state--error" role="alert"><p class="ui-state__title">The directory could not be loaded</p><p class="ui-state__why">${escapeHtml(error)} Nothing has changed.</p>${button("cong-reload", "Try again")}</div>`;
  } else if (!list) {
    body = `<p class="station__note">Reading the Bureau's register…</p>`;
  } else if (!list.length) {
    const canCharter = view && !view.conglomerate && !view.charter?.refusal;
    body = `<div class="ui-state" role="status"><p class="ui-state__title">No conglomerates yet</p><p class="ui-state__why">${canCharter ? "Nobody has filed a charter. Found the first one, and others can apply to it here." : "Nobody has filed a charter yet. When one is filed it is listed here, and you can apply to it."}</p>${button("cong-goto-charter", canCharter ? "File a charter" : "See what a charter needs", { variant: canCharter ? "primary" : "secondary" })}</div>`;
  } else {
    body = `<ul class="cong-directory">${list.map((c, i) => {
      const why = applyRefusal(view, c);
      const whyId = `cong-why-${i}`;
      return `
      <li class="ui-card cong-item" data-conglomerate="${escapeHtml(c.id)}">
        ${emblemSvg(c.emblem, c.colour)}
        <div class="cong-item__text">
          <h4 class="ui-card__title">${escapeHtml(c.name)}${view?.conglomerate?.id === c.id ? ' <span class="ui-badge ui-badge--accent">Yours</span>' : ""}</h4>
          <p class="ui-card__meta">Level ${n(c.level)} · ${n(c.memberCount)} of ${n(c.maxMembers)} members${c.memberCount >= c.maxMembers ? " · full: an application waits for room" : ""}</p>
          ${why ? `<p class="cong-item__why" id="${whyId}">${escapeHtml(why)}</p>` : ""}
        </div>
        ${view?.conglomerate?.id === c.id ? "" : `<div class="cong-actions">${button("cong-apply", "Apply", { data: { conglomerate: c.id }, disabled: Boolean(why), describedBy: why ? whyId : "" })}</div>`}
      </li>`;
    }).join("")}</ul>`;
  }
  return `
    <section class="ui-panel station__panel cong-panel" data-role="cong-directory" id="cong-directory">
      <h3>Conglomerates</h3>
      ${body}
    </section>`;
}

const ROLE_LABEL = { founder: "Founder", director: "Director", member: "Member" };

/** Who takes the founder role if the founder is absent: the longest-serving director, else the longest-serving member. */
export function heirOf(members) {
  const by = (role) => members.filter((m) => m.role === role).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  return by("director") || by("member") || null;
}

/** The caller's own conglomerate: summary, succession, roster with the controls its role holds, and the paperwork. */
export function memberHtml(view, { search } = {}) {
  const c = view?.conglomerate;
  if (!c) return "";
  const may = (id) => c.permissions.includes(id);
  const directors = c.members.filter((m) => m.role === "director").length;
  const founder = c.members.find((m) => m.role === "founder");
  const heir = heirOf(c.members);
  const me = view.me;
  const rows = c.members.map((m) => {
    const self = m.corp === me;
    const controls = [];
    if (!self && m.role !== "founder") {
      if (may("set-director") && m.role === "member") controls.push(button("cong-promote", "Make director", { data: { corp: m.corp }, disabled: directors >= c.maxDirectors }));
      if (may("set-director") && m.role === "director") controls.push(button("cong-demote", "Make member", { data: { corp: m.corp } }));
      if (may("transfer-founder") && m.role === "director") controls.push(button("cong-transfer", "Hand over founder", { data: { corp: m.corp } }));
      if (may(m.role === "director" ? "remove-director" : "remove-member")) controls.push(button("cong-remove", "Remove", { variant: "danger", data: { corp: m.corp, name: m.corpName } }));
    }
    return `<tr><td data-label="Corporation">${escapeHtml(m.corpName || "A corporation")}${self ? ' <span class="ui-badge ui-badge--accent">You</span>' : ""}</td><td data-label="Role">${ROLE_LABEL[m.role] || escapeHtml(m.role)}</td><td data-label="Joined">${bureauTime(m.joinedAt)}</td><td data-label="Actions"><div class="cong-actions">${controls.join("") || '<span class="cong-muted">None</span>'}</div></td></tr>`;
  }).join("");
  const directorsFull = may("set-director") && directors >= c.maxDirectors ? `<p class="cong-item__why">${n(c.maxDirectors)} directors is the most a conglomerate may have. Make one a member before promoting another.</p>` : "";
  const applications = c.applications.length ? `<ul class="cong-list">${c.applications.map((a) => `
      <li class="ui-card cong-item"><div class="cong-item__text"><h4 class="ui-card__title">${escapeHtml(a.corpName || "A corporation")}</h4><p class="ui-card__meta">Applied ${bureauTime(a.at)}</p></div>
      <div class="cong-actions">${may("answer-application") ? button("cong-application-accept", "Accept", { variant: "primary", data: { application: a.id }, disabled: c.memberCount >= c.maxMembers }) + button("cong-application-decline", "Decline", { variant: "ghost", data: { application: a.id } }) : '<span class="cong-muted">The founder or a director answers</span>'}</div></li>`).join("")}</ul>${c.memberCount >= c.maxMembers ? `<p class="cong-item__why">The conglomerate is full (${n(c.memberCount)} of ${n(c.maxMembers)}). An application can be accepted when a place opens.</p>` : ""}`
    : `<p class="station__note">No applications waiting.</p>`;
  const invitations = c.invitations.length ? `<ul class="cong-list">${c.invitations.map((i) => `
      <li class="ui-card cong-item"><div class="cong-item__text"><h4 class="ui-card__title">${escapeHtml(i.corpName || "A corporation")}</h4><p class="ui-card__meta">Invited ${bureauTime(i.at)}</p></div>
      <div class="cong-actions">${may("invite") ? button("cong-invitation-withdraw", "Withdraw", { variant: "ghost", data: { invitation: i.id } }) : ""}</div></li>`).join("")}</ul>` : `<p class="station__note">No invitations waiting for an answer.</p>`;
  const results = search?.results ? (search.results.length ? `<ul class="cong-list">${search.results.map((r) => `
      <li class="ui-card cong-item"><div class="cong-item__text"><h4 class="ui-card__title">${escapeHtml(r.corporationName)}</h4><p class="ui-card__meta">CEO ${escapeHtml(r.ceo || "unknown")}</p></div>
      <div class="cong-actions">${button("cong-invite", "Invite", { data: { corp: r.publicId } })}</div></li>`).join("")}</ul>` : `<p class="station__note">No corporation has a name containing that. Check the spelling, or try part of the name.</p>`) : "";
  const inviteForm = may("invite") ? `
      <form class="cong-search" data-role="cong-invite-search" novalidate>
        <div class="ui-field"><label class="ui-field__label" for="cong-invite-name">Invite a corporation</label>
        <input class="ui-input" id="cong-invite-name" name="name" maxlength="64" autocomplete="off" value="${escapeHtml(search?.name || "")}" aria-describedby="cong-invite-hint">
        <span class="ui-field__hint" id="cong-invite-hint">Search by name. The corporation answers from its own Bureau view.</span></div>
        <button type="submit" class="ui-button ui-button--secondary">Search</button>
      </form>
      <p class="cong-form-status" data-role="cong-invite-status" role="status">${escapeHtml(search?.status || "")}</p>
      ${results}` : "";
  const identity = may("set-identity") ? `
      <form class="cong-identity" data-role="cong-identity-form" novalidate>
        ${picker("emblem", EMBLEMS.length, c.emblem, c.colour)}
        ${picker("colour", COLOURS.length, c.colour, c.emblem)}
        <div class="cong-actions"><button type="submit" class="ui-button ui-button--secondary">Save emblem and colour</button></div>
      </form>` : "";
  const leaveOrDissolve = may("dissolve")
    ? `<p class="cong-panel__lede">As founder you cannot leave. Hand the founder role to a director first, or dissolve the conglomerate: the treasury is shared out equally among the members, and the name stays reserved for 30 days.</p><div class="cong-actions">${button("cong-dissolve", "Dissolve the conglomerate", { variant: "danger", disabled: !view.atBureau, describedBy: view.atBureau ? "" : "cong-dissolve-why" })}</div>${view.atBureau ? "" : '<p class="cong-item__why" id="cong-dissolve-why">A conglomerate is dissolved here at the Bureau, on Earth Station Prime. Travel back to dissolve it.</p>'}`
    : `<p class="cong-panel__lede">Leaving starts a 24-hour wait before your corporation can join another conglomerate. What it gave the treasury stays there.</p><div class="cong-actions">${button("cong-leave", "Leave the conglomerate", { variant: "danger" })}</div>`;
  return `
    <section class="ui-panel station__panel cong-panel" data-role="cong-mine">
      <div class="cong-summary">
        ${emblemSvg(c.emblem, c.colour, { size: "lg" })}
        <div class="cong-item__text">
          <h3 class="cong-summary__name">${escapeHtml(c.name)}</h3>
          <p class="ui-card__meta"><span class="ui-badge ui-badge--accent">${ROLE_LABEL[c.role]}</span> Level ${n(c.level)} · ${n(c.memberCount)} of ${n(c.maxMembers)} members · treasury ${n(c.treasury?.credits)} credits</p>
        </div>
      </div>
      <p class="cong-succession" data-role="cong-succession">Succession: if ${escapeHtml(founder?.corpName || "the founder")} does not sign in for ${n(c.founderAbsentDays)} days, the founder role passes to ${heir ? `${escapeHtml(heir.corpName || "a corporation")}, the longest-serving ${heir.role}` : "the longest-serving director, once there is another member"}.</p>
    </section>
    <section class="ui-panel station__panel cong-panel" data-role="cong-roster">
      <h3>Roster</h3>
      <div class="ui-table-wrap"><table class="ui-table cong-roster">
        <caption class="ui-table__caption">${n(c.memberCount)} member${c.memberCount === 1 ? "" : "s"}, ${n(directors)} of at most ${n(c.maxDirectors)} directors</caption>
        <thead><tr><th scope="col">Corporation</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col">Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${directorsFull}
      <p class="cong-form-status" data-role="cong-roster-status" role="status"></p>
    </section>
    <section class="ui-panel station__panel cong-panel" data-role="cong-admissions">
      <h3>Applications</h3>
      ${applications}
      <h3>Invitations sent</h3>
      ${invitations}
      ${inviteForm}
    </section>
    ${identity ? `<section class="ui-panel station__panel cong-panel" data-role="cong-identity"><h3>Emblem and colour</h3>${identity}</section>` : ""}
    <section class="ui-panel station__panel cong-panel" data-role="cong-exit">
      <h3>${may("dissolve") ? "Dissolve" : "Leave"}</h3>
      ${leaveOrDissolve}
    </section>`;
}

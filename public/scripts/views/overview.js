// The Overview tab: the corporation at a glance, the next level's requirements, and the belt expeditions.
// AB#739 (ISP-53): everything here moved from app.js unchanged.

import { milestonesFirst } from "../firstAction.js";
import { formatDurationHours, toCurrency } from "../helpers.js";
import { escapeHtml } from "../html.js";
import { requirementLink } from "../levelLinks.js";
import { levelPanelView } from "../levelPanel.js"; // AB#803
import { appState } from "../state.js";
import { conglomerateCard } from "../conglomerateBureau.js"; // ISP-201 (AB#895)
import { salvageRemainingMs } from "./shared.js";

import { numberMarkup } from "../numberChange.js"; // AB#745: marks a number that is acknowledged when it changes
export function updateOverview(data) {
  const cards = [];

  // ISP-298 (AB#1791): a corporation the Salvage Assignment is offered to, or already working it, is told so
  // here — the first thing on Overview — rather than left to find Assignments unprompted (T-078). Matched by
  // kind, not id: the offer and the active copy are the same contract, materialized from ECONOMY.salvage
  // (server/game/corporation.js), and there is currently exactly one time-served contract shape.
  const salvageOffer = (data.corp?.contractOfferings?.missions || []).find((m) => m.kind === "time-served");
  const salvageActive = (data.corp?.activeMissions || []).find((m) => m.kind === "time-served");
  if (salvageActive) {
    const remaining = salvageRemainingMs(salvageActive);
    cards.push({
      title: "ISA Salvage Assignment",
      value: remaining > 0 ? `${formatDurationHours(remaining)} remaining` : "Ready to report",
      body: remaining > 0
        ? "Reporting for documented salvage work. Return to Assignments once your time is served to collect payment."
        : "Your time is served. Report to Assignments to collect payment.",
      jump: "missions"
    });
  } else if (salvageOffer) {
    cards.push({
      title: "ISA Salvage Assignment",
      value: "Available",
      body: "The Bureau is offering emergency salvage work: no funds to lose and nothing left to sell. See Assignments.",
      jump: "missions"
    });
  }

  cards.push(
    {
      title: "Cash Reserves",
      value: toCurrency(data.corp.finances.credits),
      num: { key: "overview:credits", value: Number(data.corp.finances.credits) || 0 },
      body: "Total corporate credits on hand."
    },
    {
      title: "Net Daily Flow",
      value: toCurrency((Number(data.corp.finances.dailyRevenue) || 0) - (Number(data.corp.finances.dailyExpenses) || 0)),
      body: "Income minus costs booked in the last 24 hours. This drives long-horizon compounding over years."
    },
    // ISP-201 (AB#895): the corporation's conglomerate as the server last described it (appState.conglomerate, read by
    // views/conglomerateBureau.js; undefined until that read lands). It read data.conglomerates, which nothing supplied,
    // so it said "Independent" to every member (P-STALE-AFFORDANCE). A member's card opens the Conglomerate tab; an
    // independent corporation's opens the Bureau.
    conglomerateCard(appState.conglomerate),
    {
      title: "Military Power",
      // AB#861: the sum over the corporation's units of the unit catalog's attack and defense (data/units.json)
      value: `${data.corp.military?.power?.attack ?? 0} ATK / ${data.corp.military?.power?.defense ?? 0} DEF`,
      // ISP-173 (AB#867): readiness, which unpaid upkeep lowers and battles read
      body: (() => {
        const readiness = Math.round(Number(data.corp.military?.readiness ?? 100));
        const why = data.corp.military?.upkeep?.short ? " Upkeep is unpaid, so it falls 10 points a day, to 40; paying it restores 20 a day." : "";
        return `Readiness ${readiness}%: it scales attack and accuracy in battle.${why} Attack and defense are your units' totals from the unit catalog, before counters, accuracy and evasion.`;
      })()
    }
  );

  const wrap = document.getElementById("overview-cards");
  wrap.innerHTML = cards
    .map(
      // Bug #691 audit: the Conglomerate card's value carries a player-chosen conglomerate name.
      // ISP-77 (AB#766): a design-system card; one that leads somewhere is a real button (keyboard and all).
      (card) => {
        const figure = card.num ? numberMarkup(card.num.key, card.num.value, card.value) : escapeHtml(card.value);
        return card.jump
          ? `<button type="button" class="ui-card ui-card--interactive" data-jump="${escapeHtml(card.jump)}">
        <span class="ui-card__title">${escapeHtml(card.title)}</span>
        <span class="ui-card__figure">${figure}</span>
        <span class="ui-card__body">${escapeHtml(card.body)}</span>
      </button>`
          : `<section class="ui-card">
        <h3 class="ui-card__title">${escapeHtml(card.title)}</h3>
        <p class="ui-card__figure">${figure}</p>
        <p class="ui-card__body">${escapeHtml(card.body)}</p>
      </section>`;
      }
    )
    .join("");
}

export function renderLevel2Progress(data) {
  const requirementsWrap = document.getElementById("level2-requirements");
  const status = document.getElementById("level2-status");
  const title = document.getElementById("level-requirements-title");
  const lede = document.getElementById("level-requirements-lede");

  if (!requirementsWrap || !status) {
    return;
  }

  // AB#1056: early on, the next milestones are the first thing on the Overview, above the brief and the stat cards
  const milestonesSection = document.getElementById("overview-milestones");
  const overviewPanel = document.getElementById("overview");
  const expeditionPanel = document.getElementById("expedition-panel");
  if (milestonesSection && overviewPanel && expeditionPanel) {
    const first = milestonesFirst(data?.corp?.level);
    const isFirst = overviewPanel.firstElementChild === milestonesSection;
    if (first && !isFirst) overviewPanel.prepend(milestonesSection);
    if (!first && isFirst) expeditionPanel.after(milestonesSection);
  }

  // Map requirement IDs to the tab they should navigate to
  // TODO(AB#798): This information should be stored in the database OR in milestones.json
  // AB#2322: grouped and whole, as the card's own title writes it ("Mine 260,000 Silicate", not 150000 / 260000).
  const milestoneNumber = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

  const REQ_TAB = {
    officeRented:               "station",
    hire5:                      "station",
    hire10:                     "station",
    hire15:                     "station",
    hire25:                     "station",
    marsLease:                  "station",
    secondLease:                "station",
    lunaLease:                  "station",
    extractor:                  "station",
    extractor2:                 "station",
    extractor3:                 "station",
    mine300:                    "station",
    researchBasicExtraction:    "rnd",
    researchIndustrialSafety:   "rnd",
    researchEnergyRouting:      "rnd",
    sell300Silicate:            "market",
    sell50000Silicate:          "market",
    missions25:                 "missions",
    // Levels 6 to 10 since Bug #424
    assemblyFacility:           "station",
    refinery:                   "refinery",
    expeditions3:               "starmap",
    expeditions10:              "starmap",
    refine1000:                 "refinery",
    refine2000:                 "refinery",
    sell100000Silicate:         "market",
    researchAssemblyFabrication: "rnd",
    researchAsteroidProspecting: "rnd",
    researchMaterialCompression: "rnd",
    researchNanoLattice:        "rnd",
    researchNearStarNavigation: "rnd",
    // Levels 11 to 20 since ISP-108 (AB#800)
    extractor4:                 "station",
    extractor5:                 "station",
    extractor6:                 "station",
    thirdLease:                 "station",
    yards3AtTier2:              "station",
    yards6AtTier2:              "station",
    yards3AtTier3:              "station",
    yards6AtTier3:              "station",
    mine225kSilicate:           "station",
    mine306kSilicate:           "station",
    mine394kSilicate:           "station",
    mine476kSilicate:           "station",
    mine557kSilicate:          "station",
    refinery2:                  "refinery",
    refineryComplex:            "refinery",
    refineryTier3:              "refinery",
    refine25800:                "refinery",
    refine34800:                "refinery",
    refine44800:                "refinery",
    refine55800:                "refinery",
    refine65800:                "refinery",
    researchContainmentPhysics: "rnd",
    // Levels 21 to 30 since ISP-109 (AB#801)
    ferricMiningComplex:        "station",
    assemblyTier2:              "station",
    yards3AtTier4:              "station",
    yards6AtTier4:              "station",
    yards2AtTier5:              "station",
    mine1627kSilicate:          "station",
    mine1789kSilicate:          "station",
    refineries2AtTier3:         "refinery",
    expeditions230:             "starmap",
    expeditions250:             "starmap",
    expeditions270:             "starmap",
    expeditions289:             "starmap",
    expeditions311:             "starmap",
    missions451:                "missions",
    missions481:                "missions",
    missions511:                "missions",
    missions540:                "missions",
    missions570:                "missions",
    researchExoticEnergyRouting: "rnd",
    researchDeepStarNavigation: "rnd"
  };

  const level = Number(data?.corp?.level || 0);
  // AB#803: reaching a level moves the panel on to the new next level, whatever was being browsed.
  if (appState.levelBrowseAt !== level) {
    appState.levelBrowse = null;
    appState.levelBrowseAt = level;
  }
  const view = levelPanelView({
    level,
    levelCap: data?.corp?.levelCap,
    levelProgress: data?.corp?.levelProgress,
    ladder: appState.levelLadder,
    browse: appState.levelBrowse
  });
  const shownKey = `level${view.shown}`;
  const isNext = view.state === "next";

  // "Level N of M", M the highest level the data defines (Bug #424: never a literal).
  // Bug #4679: only the words; the title keeps its document-code slot
  const titleText = document.getElementById("level-requirements-text") || title;
  if (titleText) titleText.textContent = view.max ? `Level ${level} of ${view.max}` : `Level ${level}`;
  const meta = document.getElementById("level-panel-meta");
  if (meta) {
    const badge = {
      next: '<span class="ui-badge ui-badge--accent">Next</span>',
      reached: '<span class="ui-badge ui-badge--success">Reached</span>',
      ahead: '<span class="ui-badge">Ahead</span>'
    }[view.state];
    meta.innerHTML = `${badge} Showing Level ${view.shown}`;
  }
  const browse = document.getElementById("level-browse");
  if (browse) {
    const step = (to, label, aria) =>
      `<button type="button" class="ui-button ui-button--ghost" data-level-browse="${to ?? ""}"${to ? "" : " disabled"} aria-label="${aria}">${label}</button>`;
    browse.innerHTML =
      step(view.prev, view.prev ? `&lsaquo; Level ${view.prev}` : "&lsaquo;", view.prev ? `Show Level ${view.prev}` : "No earlier level") +
      (view.isDefault ? "" : `<button type="button" class="ui-button ui-button--secondary" data-level-browse="default">${view.atTop ? "Your level" : "Next level"}</button>`) +
      step(view.next, view.next ? `Level ${view.next} &rsaquo;` : "&rsaquo;", view.next ? `Show Level ${view.next}` : "No later level in this build");
    if (!browse.dataset.bound) {
      browse.dataset.bound = "1";
      browse.addEventListener("click", (event) => {
        const button = event.target.closest("[data-level-browse]");
        if (!button || button.disabled) return;
        const to = button.dataset.levelBrowse;
        appState.levelBrowse = to === "default" ? null : Number(to);
        if (appState.data) renderLevel2Progress(appState.data);
      });
    }
  }

  if (lede) {
    lede.textContent = view.atTop && view.shown === view.max
      ? `You have reached the highest level this build defines. Levels ${view.max + 1} to 40 are planned for a later version.`
      : isNext
        ? `Complete these requirements to advance from Level ${level} to Level ${view.shown}.`
        : view.state === "reached"
          ? `Your corporation reached Level ${view.shown}. Its requirements, as they stand today:`
          : `Level ${view.shown} opens after Level ${view.shown - 1}. Its requirements, with your progress so far:`;
  }

  const unlocksCard = document.getElementById("level-unlocks");
  if (unlocksCard) {
    unlocksCard.hidden = !view.unlocks.length;
    const unlocksTitle = document.getElementById("level-unlocks-title");
    if (unlocksTitle) unlocksTitle.textContent = view.state === "reached" ? `Level ${view.shown} unlocked` : `Reaching Level ${view.shown} unlocks`;
    const list = document.getElementById("level-unlocks-list");
    if (list) list.innerHTML = view.unlocks.map((u) => `<dt>${escapeHtml(u.label)}</dt><dd>${escapeHtml(u.value)}</dd>`).join("");
  }

  if (!view.requirements.length) {
    requirementsWrap.innerHTML =
      '<section class="ui-card"><p class="ui-card__body">No additional level requirements are currently defined for this profile.</p></section>';
    status.textContent = "";
    return;
  }

  requirementsWrap.innerHTML = view.requirements
    .map((req) => {
      const doneClass = req.complete ? " is-complete" : "";
      const reqId = `${shownKey}:${req.id}`;
      const justCompletedClass =
        isNext && appState.requirementsInitialized && req.complete && !appState.completedRequirementIds.has(reqId)
          ? " is-just-completed"
          : "";
      if (req.complete && isNext) {
        appState.completedRequirementIds.add(reqId);
      }
      // AB#1061: a lease milestone leads to the station that files its body, by way of the Starmap when docked elsewhere.
      // AB#803: only the next level's cards lead anywhere; a level reached or ahead is there to read.
      const link = isNext ? requirementLink(req, data?.corp?.currentStationId || null, appState.stationRegistry, REQ_TAB[req.id]) : null;
      const jumpAttr = link ? ` data-jump="${link.tab}"` : "";
      const clickable = link && !req.complete;
      // ISP-77 (AB#766): a milestone is a design-system card; one still to do that leads somewhere is a button.
      const tag = clickable ? 'button type="button"' : "section";
      const close = clickable ? "button" : "section";
      const stateText = req.complete ? "Completed" : link ? escapeHtml(link.label) : "In Progress";
      return `
      <${tag} class="ui-card overview__milestone${clickable ? " ui-card--interactive" : ""}${doneClass}${justCompletedClass}"${jumpAttr}>
        <span class="ui-card__title overview__milestone-title">${escapeHtml(req.title)}</span>
        <span class="ui-card__figure">${milestoneNumber(req.progress)} / ${milestoneNumber(req.target)}</span>
        <span class="ui-card__meta overview__milestone-state">${stateText}</span>
        ${!req.complete && link?.hint ? `<span class="ui-card__body">${escapeHtml(link.hint)}</span>` : ""}
      </${close}>
      `;
    })
    .join("");

  status.textContent = isNext ? `Complete the requirements above to advance from Corporation Level ${level} to ${view.shown}.` : "";
  if (isNext) appState.requirementsInitialized = true;
}

// Render the overview Asteroid Belt Expeditions panel. The starmap belt-detail
// view is rendered separately via starmap.updateExpeditionProgress().
export function renderExpeditionPanel(data) {
  const panel = document.getElementById("expedition-panel");
  if (!panel) return;
  const active = data?.corp?.asteroidMining?.activeExpeditions || [];
  if (!active.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const now = Date.now();
  const rows = active
    .map((exp) => {
      const total = Math.max(1, Number(exp.endsAt || 0) - Number(exp.startedAt || 0));
      const elapsed = Math.max(0, Math.min(total, now - Number(exp.startedAt || 0)));
      const progress = (elapsed / total) * 100;
      const remainingMs = Math.max(0, Number(exp.endsAt || 0) - now);
      const beltName = exp.beltName || exp.beltKey || "Unknown Belt";
      return `
        <article class="ui-card">
          <h4 class="ui-card__title">${escapeHtml(beltName)}</h4>
          <p class="ui-card__meta">Remaining: ${formatDurationHours(remainingMs)} (${progress.toFixed(1)}%)</p>
          <div class="progress-wrap" role="progressbar" aria-label="${escapeHtml(beltName)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><div class="progress-bar" style="width:${progress.toFixed(1)}%"></div></div>
        </article>`;
    })
    .join("");
  const list = document.getElementById("expedition-list");
  if (list) list.innerHTML = rows;
}

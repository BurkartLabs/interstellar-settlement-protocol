// The Mercenary Rentals panel on the Galactic Exchange (ISP-177, AB#871). Fetches the open offers and the caller's
// contracts, draws them (public/scripts/mercenaryView.js), and sends the three orders: offer, withdraw, hire. A hire holds
// credits, so it confirms first and shows its receipt after (AB#744).
import { apiFetch, parseJsonResponse } from "../apiClient.js";
import { deepClone } from "../helpers.js";
import { myContractsHtml, offerFormHtml, offerPreview, offersTableHtml } from "../mercenaryView.js";
import { appState } from "../state.js";
import { pushFeedback, showTradeConfirmation, updateAllViews } from "./shared.js";
import { escapeHtml } from "../html.js";
import { protocolLineHtml, refusalMeaning } from "../protocol.js"; // ISP-254 (AB#4817)

/** ISP-254 (AB#4817): Mercenary Rentals are on the Galactic Exchange: an outcome's protocol on that screen. */
const onExchange = (meaning) => ({ meaning, screen: "market" });
const refusedOnExchange = (error) => onExchange(refusalMeaning(error));
import { showActionReceipt } from "./receiptModal.js";

const MIN_REFETCH_MS = 5_000;
let lastFetch = 0;
let cache = null;
let formKey = ""; // the form is drawn again only when the fleets it offers change, so a redraw never eats typing
const path = (rest) => `/api/accounts/${encodeURIComponent(appState.accountId)}/gameplay/mercenaries${rest}`;
const money = (n) => `¤${Math.round(Number(n) || 0).toLocaleString("en-US")}`;


export async function renderMercenaries(data, { force = false } = {}) {
  const section = document.getElementById("exchange-mercenary-section");
  if (!section || !appState.accountId) return;
  const now = Date.now();
  if (force || !cache || now - lastFetch > MIN_REFETCH_MS) {
    lastFetch = now;
    try {
      const [offers, mine] = await Promise.all([
        parseJsonResponse(await apiFetch(path(""))),
        parseJsonResponse(await apiFetch(path("/mine")))
      ]);
      cache = { offers: offers.offers || [], mine };
    } catch (error) {
      document.getElementById("merc-status").innerHTML = `${escapeHtml(error?.message || "Mercenary offers could not be loaded.")} ${protocolLineHtml(onExchange("failed"))}`;
      return;
    }
  }
  document.getElementById("merc-offers").innerHTML = offersTableHtml(cache.offers, appState.units);
  const fleets = data.corp?.military?.fleets || [];
  const key = JSON.stringify(fleets.map((f) => [f.id, f.name, f.units, Boolean(f.contract), f.transit?.arrivesAt ?? 0]).concat([cache.mine?.fleetValues || {}]));
  if (force || key !== formKey) {
    formKey = key;
    document.getElementById("merc-offer-form").innerHTML = offerFormHtml(fleets, (f) => cache.mine?.fleetValues?.[f.id] || 0, appState.units, now);
  }
  document.getElementById("merc-mine").innerHTML = myContractsHtml(cache.mine, appState.units, now);
  const forHire = cache.offers.filter((o) => !o.mine).length;
  document.getElementById("merc-status").textContent = `${forHire} fleet${forHire === 1 ? "" : "s"} for hire.`;
  bind(section);
}

function bind(section) {
  const form = section.querySelector("[data-merc-form]");
  if (form) {
    const preview = () => {
      const fleet = form.querySelector("[data-merc-fleet]").selectedOptions[0];
      const value = Number(fleet?.dataset.value) || 0;
      const coll = form.querySelector("[data-merc-collateral]");
      coll.max = String(value);
      form.querySelector("[data-merc-price]").max = String(value); // Bug #4800: the price is capped by the fleet's value too
      form.querySelector("[data-merc-preview]").textContent = offerPreview({
        termHours: Number(form.querySelector("[data-merc-term]").value), price: form.querySelector("[data-merc-price]").value, collateral: coll.value, value
      }).text;
    };
    form.oninput = preview;
    form.onchange = preview;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const status = form.querySelector("[role=status]");
      const button = form.querySelector("[data-merc-offer-submit]");
      button.disabled = true;
      try {
        await parseJsonResponse(await apiFetch(path("/offer"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fleetId: form.querySelector("[data-merc-fleet]").value, termHours: Number(form.querySelector("[data-merc-term]").value),
            price: Number(form.querySelector("[data-merc-price]").value), collateral: Number(form.querySelector("[data-merc-collateral]").value),
            allowedUse: form.querySelector("[data-merc-use]").value
          })
        }));
        pushFeedback("Your fleet is on offer.", "ok", onExchange("pending"));
        await refreshAccount();
      } catch (error) {
        status.innerHTML = `${escapeHtml(error?.message || "The offer was refused.")} ${protocolLineHtml(refusedOnExchange(error))}`;
        button.disabled = false;
      }
    };
  }
  section.onclick = async (event) => {
    const withdraw = event.target.closest("[data-merc-withdraw]");
    if (withdraw && !withdraw.disabled) {
      withdraw.disabled = true;
      try {
        await parseJsonResponse(await apiFetch(path(`/${encodeURIComponent(withdraw.getAttribute("data-merc-withdraw"))}/withdraw`), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
        pushFeedback("Offer withdrawn.", "ok", onExchange("cancelled"));
        await refreshAccount();
      } catch (error) { pushFeedback(error?.message || "Could not withdraw.", "warn", refusedOnExchange(error)); withdraw.disabled = false; }
      return;
    }
    const hire = event.target.closest("[data-merc-hire]");
    if (hire && !hire.disabled) await hireOffer(hire);
  };
}

async function hireOffer(button) {
  const offer = (cache?.offers || []).find((o) => o.id === button.getAttribute("data-merc-hire"));
  if (!offer) return;
  const ok = await showTradeConfirmation({
    heading: "Mercenary Contract", title: `Hire ${offer.fleetName}?`, confirmLabel: "Hire",
    rows: [
      { label: "Price", value: `${money(offer.price)}, to the owner when the term ends` },
      { label: "Collateral", value: `${money(offer.collateral)}, back to you less any units lost` },
      { label: "Held now", value: money(offer.price + offer.collateral), highlight: true },
      { label: "Term", value: `${offer.termHours} hours` }
    ]
  });
  if (!ok) return;
  button.disabled = true;
  try {
    const account = await parseJsonResponse(await apiFetch(path(`/${encodeURIComponent(offer.id)}/hire`), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    appState.data = deepClone(account.state);
    lastFetch = 0;
    updateAllViews();
    pushFeedback(account.receipt?.title || "Fleet hired.", "ok", onExchange("active"));
    showActionReceipt(account, { returnFocusTo: () => document.querySelector("#exchange-mercenary-section h3") });
  } catch (error) {
    pushFeedback(error?.message || "The hire was refused.", "warn", refusedOnExchange(error));
    button.disabled = false;
  }
}

async function refreshAccount() {
  const account = await parseJsonResponse(await apiFetch(`/api/accounts/${encodeURIComponent(appState.accountId)}`));
  appState.data = deepClone(account.state);
  lastFetch = 0;
  updateAllViews();
  await renderMercenaries(appState.data, { force: true });
}

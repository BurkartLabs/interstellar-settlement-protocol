// public/scripts/npcProfile.js
// ISP-124 (AB#818): NPC corporations visible on the Exchange. An NPC order's counterparty is shown with a badge, "NPC"
// for a corporation and "Authority" for the GEX or the ISA, and its name opens a profile card from the catalog
// (data/npc-corporations.json, sent with the market as `npcDirectory`). Only NPC rows call counterpartyHtml, and a
// name the directory does not know is shown plain, so a player's name can never carry the badge; nor could a player
// register an NPC's name (AB#813).
import { escapeHtml } from "./html.js";

/** The directory entry for `name`: { kind: "corporation" | "authority", ... }, or null for anyone else. */
export function npcEntry(name, directory) {
  const n = String(name || "").trim();
  if (!n || !directory) return null;
  const corp = (directory.corporations || []).find((c) => c.name === n);
  if (corp) return { kind: "corporation", ...corp };
  const authority = (directory.authorities || []).find((a) => a.name === n);
  return authority ? { kind: "authority", ...authority } : null;
}

/** An NPC order's counterparty cell: the name as a button that opens its card, and the badge. Plain text otherwise. */
export function counterpartyHtml(name, directory) {
  const entry = npcEntry(name, directory);
  const safe = escapeHtml(name || "");
  if (!entry) return `<span data-counterparty-name>${safe}</span>`;
  const badge = entry.kind === "authority" ? "Authority" : "NPC";
  return `<span class="exchange__seller"><button type="button" class="ui-button ui-button--ghost exchange__npc-name" data-npc-profile="${safe}" aria-haspopup="dialog"><span data-counterparty-name>${safe}</span></button> <span class="ui-badge" data-npc-badge>${badge}</span></span>`;
}

/** The profile card for an entry: its heading, title and body, every field from the catalog. */
export function npcProfileView(entry) {
  if (!entry) return null;
  if (entry.kind === "authority") {
    return {
      heading: "Authority",
      title: entry.name,
      bodyHtml: `<p class="npc-profile__flavour">${escapeHtml(entry.role || "")}</p><p class="npc-profile__note">An institution of the game, not a corporation: it runs part of the market and does not trade for itself.</p>`
    };
  }
  const trades = (entry.trades || []).map((t) => escapeHtml(t)).join(", ");
  return {
    heading: "NPC corporation",
    title: entry.name,
    bodyHtml:
      `<p class="npc-profile__flavour">${escapeHtml(entry.flavour || "")}</p>` +
      `<dl class="ui-kv npc-profile__facts"><dt>Home station</dt><dd data-npc-field="home">${escapeHtml(entry.homeStation || "")}</dd>` +
      `<dt>Trades</dt><dd data-npc-field="trades">${trades}</dd></dl>` +
      `<p class="npc-profile__note">Run by the game. Its orders are posted by the exchange at published prices; it never takes a player's order and sees nothing a player cannot.</p>`
  };
}

// server/game/conglomerateLevels.js: buying a conglomerate's next level (ISP-202, AB#896; docs/design/CONGLOMERATES.md,
// "The level ladder, 5 to 100 members"). A level is room and nothing else: it raises maxMembers. The founder buys it at
// the Bureau, from the treasury, when levelStatus (server/game/conglomerates.js) says every requirement is met.
//
// The request names the level it buys, so a repeated call cannot buy two: the second finds the conglomerate already at
// that level (409). The payment and the new level are one synchronous step. Nothing here or anywhere lowers a level
// when members leave; only arrears will (with upkeep, AB#898), and even that removes nobody.

import { CONGLOMERATE_CATALOG, can } from "../conglomerates.js";
import { pushSystemNotification } from "./progression.js";
import { saveAccountsNow } from "./store.js";
import { levelStatus, publicConglomerate } from "./conglomerates.js";
import { NOT_FOUND, accountByCorp, context, no, roomEvent } from "./membership.js";

/** Buy level `requested` (the one after the current) for the caller's conglomerate. */
export function buyConglomerateLevel(accountId, conglomerateId, requested, now = Date.now()) {
  const ctx = context(accountId, conglomerateId, now);
  if (ctx.refused) return ctx;
  const { corp, c, role } = ctx;
  if (!role) return NOT_FOUND.conglomerate();
  if (!can(role, "buy-level")) return no(403, "not-permitted", "Only the founder can buy a level, from the treasury.");
  if (!Number.isInteger(requested)) return no(400, "level-required", "Name the level to buy.");
  if (requested <= c.level) return no(409, "already-at-level", `${c.name} is already level ${c.level}.`);
  if (requested !== c.level + 1) return no(409, "one-level-at-a-time", `Levels are bought one at a time: the next is level ${c.level + 1}.`);
  if (corp.currentStationId !== CONGLOMERATE_CATALOG.charterStationId) {
    return no(409, "not-at-bureau", "Levels are bought at the Conglomerate Affairs Bureau on Earth Station Prime. Travel there, then buy it.");
  }
  const status = levelStatus(c, now);
  if (status.refusal) return no(503, "level-unavailable", `${status.refusal} The Bureau cannot sell this level just now.`);
  if (status.top) return no(409, "top-level", `${c.name} is at the highest level, ${c.level}.`);
  const unmet = status.requirements.filter((r) => !r.met);
  if (unmet.length) {
    return no(409, "requirements-unmet", `Level ${status.next.level} needs: ${unmet.map((r) => r.label).join("; ")}.`);
  }
  // One step: the payment, the level, the room and the clock for the next.
  c.treasury.credits = Math.floor(Number(c.treasury.credits) || 0) - status.next.cost;
  c.level = status.next.level;
  c.maxMembers = status.next.maxMembers;
  c.levelSince = now;
  saveAccountsNow();
  for (const m of c.members) {
    const account = accountByCorp(m.corp);
    if (account) pushSystemNotification(account, { type: "system", title: `${c.name} reached level ${c.level}`, body: `Your conglomerate now has room for ${c.maxMembers} members.` });
  }
  roomEvent(c, "conglomerate:levelled", { level: c.level, maxMembers: c.maxMembers, cost: status.next.cost });
  return { conglomerate: publicConglomerate(c), treasury: { credits: c.treasury.credits } };
}

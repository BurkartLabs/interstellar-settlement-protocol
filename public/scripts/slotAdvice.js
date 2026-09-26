// What to do when building slots run out (Bug #1057). Shared by the server's errors and the lease page, so both say
// the same thing.
//
// The slot errors used to say "upgrade your lease tier", "acquire an additional claim", "upgrade your headquarters"
// or "release an existing building", and the game can do none of them. What it can do: a lease has two slots and
// there is one lease per body; each new lease adds two corporation building slots; and a corporation level raises
// the corporation's slots to that level's figure (data/milestones.json) when it is higher than what it already has.
//
// `unleased` is [{ body, station }]: the bodies the corporation can still lease, each with the station whose
// ISA Claims & Leases Division files it. The server works it out from the catalog, the page from its lease list.

import { leaseHasRoom, leaseSlotsUsed } from "./leaseSlots.js"; // ISP-98 (AB#788)

const OFFICE = "the ISA Claims & Leases Division";

/** "Mars (at Mars Orbital Dock) or Luna (at Luna Gateway)". */
function bodyList(unleased) {
  const parts = unleased.map((b) => `${b.body} (at ${b.station})`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}` : parts[0];
}

/** What to do about a full lease, without the sentence saying it is full. */
export function leaseFullAdvice(corp, lease, unleased = []) {
  const roomy = (corp?.miningLeases || []).find((l) => l !== lease && l?.id !== lease?.id && leaseHasRoom(l)); // ISP-98: facilities count
  if (roomy) return `Your ${roomy.body} lease still has room: build there.`;
  if (unleased.length) return `To build more extractors, file a lease on ${bodyList(unleased)}: travel there and apply at ${OFFICE}.`;
  return "Every body the ISA leases is already claimed by your corporation, so this is the most extractors it can run.";
}

/** The error when a lease's own slots are full. */
export function leaseSlotsFullMessage(corp, lease, unleased = []) {
  const used = leaseSlotsUsed(lease); // ISP-98 (AB#788): extractors and the other buildings on the lease
  return `This ${lease?.body || "mining"} lease has used both of its building slots (${used}/${lease?.buildingSlots || 2}). ${leaseFullAdvice(corp, lease, unleased)}`;
}

/** The next corporation level whose building slots are more than the corporation has, as { level, slots }, or null. */
export function nextSlotLevel(levels, corp) {
  const have = corp?.buildingSlots || 2;
  return [...(levels || [])]
    .filter((l) => l.level > (corp?.level || 0) && Number(l.unlocks?.buildingSlots) > have)
    .sort((a, b) => a.level - b.level)
    .map((l) => ({ level: l.level, slots: l.unlocks.buildingSlots }))[0] || null;
}

/** The error when the corporation's own building slots are all in use. `levels` is data/milestones.json's levels. */
export function corporationSlotsFullMessage(corp, unleased = [], levels = []) {
  const parts = [`All ${(corp?.buildings || []).length}/${corp?.buildingSlots || 2} of your corporation's building slots are in use.`];
  if (unleased.length) parts.push(`Each new mining lease adds 2: file one on ${bodyList(unleased)} at ${OFFICE}.`);
  const next = nextSlotLevel(levels, corp);
  if (next) parts.push(`Reaching corporation level ${next.level} raises the total to ${next.slots}.`);
  if (!unleased.length && !next) parts.push("That is the most the game allows for now.");
  return parts.join(" ");
}

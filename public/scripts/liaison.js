// The ISA officer the Bureau assigns to every newly chartered corporation (AB#585).
//
// One source for her name, title and portrait: the welcome letter (server/gameState.js), the intro dialogue and the
// walkthrough (public/scripts/app.js) and her Assignments Bureau entry (MISSION_AGENTS) all read it, so the four can
// no longer disagree. There used to be a second Voss, "Aria", with a different title; the Board removed her
// (2026-09-20): she was an oversight.
export const ASSIGNED_COORDINATOR = Object.freeze({
  id: "elara-voss",
  name: "Elara Voss",
  title: "Senior Logistics Coordinator",
  faction: "Interstellar Settlement Authority",
  factionCode: "ISA",
  portrait: "/images/elara_voss.jpg"
});

/** "Elara Voss, Senior Logistics Coordinator" - the one way her name and title are written together. */
export const COORDINATOR_BYLINE = `${ASSIGNED_COORDINATOR.name}, ${ASSIGNED_COORDINATOR.title}`;

/**
 * The welcome letter every new corporation finds in its inbox: { subject, fromName, body }.
 * Signed by the assigned coordinator (AB#585), who is also the officer with work for the player later on.
 */
export function welcomeLetter(corpName, accountId) {
  const corp = String(corpName || "Frontier Protocol Ventures").trim();
  const ref = String(accountId || "").toUpperCase();
  return {
    subject: `ISA Settlement Licence — Ref. ISP-2147-${ref}-AUTH`,
    fromName: ASSIGNED_COORDINATOR.faction,
    body:
      `To the registered CEO of ${corp},\n\n` +
      `Your corporation has been assessed and approved under the provisions of the Interstellar Settlement Protocol (Earth Assembly Act, 2147).\n\n` +
      `This licence grants your corporation the legal right to:\n` +
      `  — Establish a registered operational presence at any ISA-recognised station\n` +
      `  — Apply for extraction rights across approved bodies within the Sol system\n` +
      `  — Engage in commerce on the Galactic Exchange under your registered charter\n\n` +
      `The Contracting & Assignments Bureau assigns every newly chartered corporation a coordinator. I have been assigned to yours. My office is on Deck 7 of the Bureau at Earth Station Prime.\n\n` +
      `Your first recommended action is to secure office space at Earth Station Prime. Enclosed is your Founding Charter reference number for all future ISA correspondence.\n\n` +
      `Founding Charter Ref: ISP/${ref}/FC-001\n\n` +
      `${ASSIGNED_COORDINATOR.name}\n${ASSIGNED_COORDINATOR.title}\n${ASSIGNED_COORDINATOR.faction} — Earth Station Prime`
  };
}

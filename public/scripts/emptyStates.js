// Empty states that name the next thing to do (Bug #1060). They used to state a fact ("No messages here."), or point at
// a form the player could not use yet ("Submit a lease application below" above "an office is required").

/** The Inbox list when a folder (or the Inbox's System & NPC / Players subtab) holds nothing. */
export function inboxEmptyText(folder, subtype) {
  if (folder === "inbox") {
    return subtype === "players"
      ? "No player mail yet. Compose to write to another corporation."
      : "No messages from the ISA or the station offices yet. They write when something needs your attention.";
  }
  if (folder === "sent") return "Nothing sent yet. Compose to write to another corporation.";
  if (folder === "draft") return "No drafts. A message you save without sending waits here.";
  if (folder === "archive") return "Nothing archived. Archive a message to keep it without it sitting in your Inbox.";
  if (folder === "trash") return "Trash is empty.";
  return "No messages here.";
}

/** ISA Claims, the corporation's leases, when it holds none. Without an office the form below is not offered yet. */
export function claimsNoLeasesText(hasOffice) {
  return hasOffice
    ? "No active extraction claims on file. File a lease application below to begin."
    : "No active extraction claims on file.";
}

/**
 * ISA Claims when this station's body is already leased: where the other leases are filed, by station name.
 *   offeredBodies: the bodies the claims office leases; ownedBodies: those the corporation holds;
 *   stations: the station registry ({ name, body }).
 */
export function claimsAllTakenText({ offeredBodies = [], ownedBodies = [], stations = [] } = {}) {
  const owned = new Set(ownedBodies);
  const elsewhere = offeredBodies
    .filter((body) => !owned.has(body))
    .map((body) => ({ body, station: stations.find((s) => s.body === body)?.name }))
    .filter((x) => x.station);
  if (!elsewhere.length) return "Your corporation holds every extraction lease the ISA offers.";
  const where = elsewhere.map((x) => `${x.body} from ${x.station}`).join(", ");
  return `Your corporation holds this station's lease. Other bodies are leased from the station that orbits them: ${where}.`;
}

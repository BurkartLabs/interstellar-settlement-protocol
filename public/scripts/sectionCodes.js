// public/scripts/sectionCodes.js: the document-code section header (ISP-248, AB#944; docs/design/BUREAUCRATIC_UI.md).
// A registered screen or section title carries an empty slot, <span class="ui-code" data-code-for="ID" aria-hidden="true">,
// before its plain words; this module fills it as "CODE // " from the registry the server serves (GET /api/section-codes,
// data/section-codes.json). A code is never written anywhere else, so it cannot drift from the registry. The slot is
// aria-hidden: a section's accessible name stays its plain title. An unknown id, or a registry that did not load,
// leaves the slot empty and the plain title alone, which is the guide's rule: the plain words always stay.

import { escapeHtml } from "./html.js";

let codes = new Map();

/** Take the registry: every screen's and section's code by its id. */
export function setSectionCodes(registry) {
  codes = new Map([...(registry?.screens || []), ...(registry?.sections || [])].map((e) => [e.id, e.code]));
}

/** What a slot shows for `id`: "CODE // ", or "" for an id the registry lacks. */
export const codeText = (id) => (codes.has(id) ? `${codes.get(id)} // ` : "");

/** A slot for markup a view draws itself (the Station's and Travel's screen titles), filled if the registry is in. */
export function codeSlotHtml(id) {
  return `<span class="ui-code" data-code-for="${escapeHtml(id)}" aria-hidden="true">${escapeHtml(codeText(id))}</span>`;
}

/** Fill every slot under `root`. */
export function applySectionCodes(root = document) {
  for (const el of root.querySelectorAll("[data-code-for]")) el.textContent = codeText(el.getAttribute("data-code-for"));
}

/** Read the registry once and fill the page. A failed read leaves the plain titles, never an error. */
export async function loadSectionCodes(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn("/api/section-codes");
    if (res.ok) setSectionCodes(await res.json());
  } catch {
    // Without codes the titles read as they always did.
  }
  applySectionCodes();
}

// server/sectionCodes.js: the document-code registry (ISP-247, AB#943; data/section-codes.json), read once, for
// GET /api/section-codes (server/routes/catalog.js). The page fills its code slots from that answer (ISP-248, AB#944).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "section-codes.json");
export const SECTION_CODES = Object.freeze(JSON.parse(fs.readFileSync(FILE, "utf8")));

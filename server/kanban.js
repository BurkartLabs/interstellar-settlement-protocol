import fs from "node:fs";
import path from "node:path";
import express from "express";
import { dataDir } from "./game/catalog.js";

const router = express.Router();
// Bug #4828: the board's file is the repository's tracked kanban/kanbanState.json only on a developer's server. A test
// server (vitest's route walks, Playwright's servers: NODE_ENV=test) keeps it in its data directory with state.json
// (data/ when ISP_DATA_DIR is unset, where it is gitignored), so a suite run no longer overwrites the tracked file.
// ISP_KANBAN_PATH names another file outright. Read on each call.
function kanbanPath() {
  if (process.env.ISP_KANBAN_PATH) return process.env.ISP_KANBAN_PATH;
  if (process.env.NODE_ENV === "test") return path.join(dataDir, "kanbanState.json");
  return path.join(process.cwd(), "kanban", "kanbanState.json");
}

function loadKanban() {
  const KANBAN_PATH = kanbanPath();
  if (!fs.existsSync(KANBAN_PATH)) {
    return {
      columns: [
        { id: "todo", name: "To Do", cards: [] },
        { id: "doing", name: "Doing", cards: [] },
        { id: "qa", name: "QA", cards: [] },
        { id: "done", name: "Done", cards: [] }
      ]
    };
  }
  return JSON.parse(fs.readFileSync(KANBAN_PATH, "utf8"));
}

function saveKanban(state) {
  fs.writeFileSync(kanbanPath(), JSON.stringify(state, null, 2), "utf8");
}

// GET /kanban/api
router.get("/api", (req, res) => {
  res.json(loadKanban());
});

// POST /kanban/api
router.post("/api", (req, res) => {
  saveKanban(req.body);
  res.json({ ok: true });
});

export default router;

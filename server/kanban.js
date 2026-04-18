import fs from "node:fs";
import path from "node:path";
import express from "express";

const router = express.Router();
const KANBAN_PATH = path.join(process.cwd(), "kanban", "kanbanState.json");

function loadKanban() {
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
  fs.writeFileSync(KANBAN_PATH, JSON.stringify(state, null, 2), "utf8");
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

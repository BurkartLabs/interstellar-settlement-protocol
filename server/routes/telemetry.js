// server/routes/telemetry.js (ISP-256, AB#952): POST /api/telemetry, where the page sends its minimum events
// (server/telemetry.js says what is kept). Open to anyone, like the page it serves: an event carries no account and
// the store keeps none. Guarded where it is mounted (server/index.js): its own rate-limit group per address, and a body
// of at most 8 KB. Here: at most MAX_EVENTS_PER_REQUEST events, each valid one stored and each invalid one dropped.
import { MAX_EVENTS_PER_REQUEST, recordTelemetry } from "../telemetry.js";

export function registerTelemetryRoutes(app) {
  app.post("/api/telemetry", (req, res) => {
    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0) {
      res.status(400).json({ error: "Send { events: [...] } with at least one event." });
      return;
    }
    if (events.length > MAX_EVENTS_PER_REQUEST) {
      res.status(400).json({ error: `At most ${MAX_EVENTS_PER_REQUEST} events a request; send the rest in another.` });
      return;
    }
    try {
      res.status(202).json(recordTelemetry(events));
    } catch (error) {
      console.error("[telemetry] could not store events:", error?.message || error);
      res.status(503).json({ error: "Telemetry could not be stored just now. Nothing was kept." });
    }
  });
}

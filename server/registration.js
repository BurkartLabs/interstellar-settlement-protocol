// server/registration.js: whether a stranger may register (AB#781). The Board answered D-0.5-5 (AB#697): "Once beta,
// anybody should be able to register." So there is no invitation, and REGISTRATION_OPEN is the one switch that closes
// registration without a code change. Unset is open, the beta's default. A value it cannot read closes registration
// and is logged once: a typo in the switch must never quietly leave it open. Read on every registration, so a new
// value applies as soon as the process holding it has it (ops/infra/isp/RUNBOOK.md in hq says how to flip it).

const OPEN = new Set(["true", "1", "yes", "on", "open"]);
const CLOSED = new Set(["false", "0", "no", "off", "closed"]);
const warned = new Set();

export const REGISTRATION_CLOSED_MESSAGE = "Registration is closed for now.";

export function registrationOpen(env = process.env, warn = (line) => console.warn(line)) {
  const raw = env.REGISTRATION_OPEN;
  if (raw === undefined) return true;
  const value = String(raw).trim().toLowerCase();
  if (OPEN.has(value)) return true;
  if (CLOSED.has(value)) return false;
  if (!warned.has(raw)) {
    warned.add(raw);
    warn(`[registration] REGISTRATION_OPEN=${JSON.stringify(String(raw).slice(0, 40))} is not true or false: registration is closed until it is.`);
  }
  return false;
}

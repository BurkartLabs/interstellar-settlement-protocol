// server/mailTestTransport.js: the test transport (AB#987). It sends nothing: every message is kept in an in-memory
// outbox, for tests and local development. It refuses to load under NODE_ENV=production, so a deployed server can never
// "send" a verification link into memory and report success.

if (process.env.NODE_ENV === "production") {
  throw new Error("The test mail transport does not load under NODE_ENV=production; configure a real transport (AB#989).");
}

const OUTBOX_LIMIT = 200;
const outbox = [];

export const testTransport = {
  name: "test",
  async send({ to, subject, text }) {
    outbox.push({ to, subject, text, at: Date.now() });
    if (outbox.length > OUTBOX_LIMIT) outbox.splice(0, outbox.length - OUTBOX_LIMIT);
  }
};

export function outboxMessages() {
  return outbox.map((m) => ({ ...m }));
}

export function clearOutbox() {
  outbox.length = 0;
}

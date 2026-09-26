// server/mail.js: the one way the server sends email (AB#987, ISP-280). One interface, sendMail({ to, subject, text }),
// over one transport. Outside production that is the test transport (server/mailTestTransport.js), which keeps every
// message in an in-memory outbox. In production it is SMTP (server/mailSmtpTransport.js, AB#989), with the free provider
// the Board chose (AB#981) as configuration; until all of ISP_SMTP_HOST, ISP_SMTP_USER, ISP_SMTP_PASSWORD and
// ISP_MAIL_FROM are set there is no transport, and anything that needs mail fails closed.
//
// Links in mail are built from ISP_PUBLIC_URL, never from a request's Host header, which the client controls.

// The test transport refuses to load under NODE_ENV=production, so it is imported only outside it.
const testModule = process.env.NODE_ENV === "production" ? null : await import("./mailTestTransport.js");
const smtpModule = process.env.NODE_ENV === "production" ? await import("./mailSmtpTransport.js") : null;
const smtpConfig = smtpModule ? smtpModule.smtpConfigFromEnv(process.env) : null;
const transport = testModule ? testModule.testTransport : smtpConfig ? smtpModule.createSmtpTransport(smtpConfig) : null;
if (process.env.NODE_ENV === "production" && !transport) console.warn("[mail] no SMTP transport configured (AB#989): registration and password reset answer 503.");

/** The origin links in mail point at, without a trailing slash; null when none is usable (production needs one set). */
export function publicBaseUrl() {
  const configured = process.env.ISP_PUBLIC_URL;
  if (configured !== undefined && configured !== "") {
    try {
      const url = new URL(configured.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === "production") return null;
  return `http://localhost:${process.env.PORT || 3000}`;
}

/** Whether mail can be sent here: a transport, and a base URL for its links. */
export async function mailAvailable() {
  return Boolean(transport && publicBaseUrl());
}

export class MailUnavailableError extends Error {
  constructor() {
    super("Email is not available on this server.");
    this.name = "MailUnavailableError";
  }
}

/** Send one message. Throws MailUnavailableError when there is no transport; the caller refuses the request. */
export async function sendMail({ to, subject, text }) {
  if (!transport) throw new MailUnavailableError();
  await transport.send({ to, subject, text });
}

function outboxModule() {
  if (!testModule) throw new Error("There is no test outbox under NODE_ENV=production.");
  return testModule;
}

/** What the test transport has captured, oldest first. Not available under NODE_ENV=production. */
export function testOutbox() {
  return outboxModule().outboxMessages();
}

export function clearTestOutbox() {
  outboxModule().clearOutbox();
}

// server/mailSmtpTransport.js: sending mail over SMTP (ISP-282, AB#989). The Board's answer to D-email (AB#981) was
// "find a free option": free SMTP is offered by many providers (a Gmail account with an app password, Brevo, Mailjet,
// Outlook), so this speaks plain SMTP and the provider is configuration, chosen and signed up for by the Board. No
// dependency: the dialogue is the small part of RFC 5321 a submission server needs.
//
// Security (DOCTRINE constraint 1):
// - TLS always: port 465 connects over TLS, any other port must offer STARTTLS or nothing is sent, and certificates
//   are verified. No configuration turns this off; tests replace the socket functions instead.
// - The password is ISP_SMTP_PASSWORD, set from a Key Vault reference (ops/infra/isp/isp.bicep); it is never logged.
// - A recipient or subject carrying CR or LF is refused, so a header cannot be injected; the body is base64.
// - Errors say which step failed and the server's reply code, never the recipient address or the credentials.

import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

const TIMEOUT_MS = 20_000;
const ADDRESS = /^[^\s@<>()",;:\\[\]]{1,64}@[^\s@<>()",;:\\[\]]{1,255}$/;

export class MailSendError extends Error {
  constructor(step, code) {
    super(`SMTP ${step} failed${code ? ` (${code})` : ""}.`);
    this.name = "MailSendError";
    this.step = step;
    this.code = code;
  }
}

/**
 * The transport's settings from the environment, or null when any is missing or unusable, in which case there is no
 * transport and mail fails closed (server/mail.js). ISP_MAIL_FROM is the sender address the provider allows.
 */
export function smtpConfigFromEnv(env = process.env) {
  const host = String(env.ISP_SMTP_HOST || "").trim();
  const port = Number(env.ISP_SMTP_PORT || 465);
  const user = String(env.ISP_SMTP_USER || "").trim();
  const password = String(env.ISP_SMTP_PASSWORD || "");
  const from = String(env.ISP_MAIL_FROM || "").trim();
  const fromName = String(env.ISP_MAIL_FROM_NAME || "Interstellar Settlement Protocol").replace(/[\r\n"]/g, "").trim();
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host) || !user || !password || !ADDRESS.test(from)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, user, password, from, fromName };
}

/** RFC 2047 for a header value that is not plain ASCII. */
function headerText(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** The whole message: headers and a base64 body in lines of 76. */
export function buildMessage({ from, fromName, to, subject, text, now = new Date(), host = "localhost" }) {
  const body = Buffer.from(String(text ?? ""), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: "${headerText(fromName)}" <${from}>`,
    `To: <${to}>`,
    `Subject: ${headerText(subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${host}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body
  ].join("\r\n");
}

/** Reads SMTP replies, one at a time; a reply is complete at the line whose code is followed by a space. */
function replyReader(getSocket) {
  let buffer = "";
  let waiting = null;
  const lines = [];
  const pump = () => {
    let at;
    while ((at = buffer.indexOf("\r\n")) >= 0) {
      lines.push(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
    }
    const end = lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
    if (end >= 0 && waiting) {
      const reply = lines.splice(0, end + 1);
      const resolve = waiting.resolve;
      waiting = null;
      resolve({ code: Number(reply[reply.length - 1].slice(0, 3)), lines: reply });
    }
  };
  const onData = (chunk) => { buffer += chunk.toString("utf8"); pump(); };
  const onError = (error) => { if (waiting) { const reject = waiting.reject; waiting = null; reject(error); } };
  let bound = null;
  return {
    attach() {
      if (bound) { bound.off("data", onData); bound.off("error", onError); bound.off("close", onClose); }
      bound = getSocket();
      bound.on("data", onData);
      bound.on("error", onError);
      bound.on("close", onClose);
    },
    next() {
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; pump(); });
    }
  };
  function onClose() { onError(new Error("closed")); }
}

/**
 * An SMTP transport for server/mail.js: { name, send({ to, subject, text }) }. `connect(config)` resolves to a socket
 * (TLS on 465, plain elsewhere) and `upgrade(socket, config)` to a TLS socket after STARTTLS; tests pass their own.
 */
export function createSmtpTransport(config, { connect = defaultConnect, upgrade = defaultUpgrade, timeoutMs = TIMEOUT_MS } = {}) {
  return {
    name: "smtp",
    async send({ to, subject, text }) {
      const recipient = String(to || "");
      const title = String(subject || "");
      if (!ADDRESS.test(recipient) || /[\r\n]/.test(recipient) || /[\r\n]/.test(title)) throw new MailSendError("address");

      let socket = await connect(config);
      const reader = replyReader(() => socket);
      reader.attach();
      const timer = setTimeout(() => socket.destroy(new Error("timeout")), timeoutMs);
      const say = (line) => socket.write(`${line}\r\n`);
      const expect = async (step, ...codes) => {
        let reply;
        try { reply = await reader.next(); } catch { throw new MailSendError(step); }
        if (!codes.includes(reply.code)) throw new MailSendError(step, reply.code);
        return reply;
      };
      try {
        await expect("greeting", 220);
        say(`EHLO ${config.heloName || "isp.local"}`);
        let ehlo = await expect("EHLO", 250);
        if (!socket.encrypted) {
          // Nothing, not even the credentials, goes over a connection that is not encrypted.
          if (!ehlo.lines.some((l) => /^250[ -]STARTTLS\b/i.test(l))) throw new MailSendError("STARTTLS not offered");
          say("STARTTLS");
          await expect("STARTTLS", 220);
          socket = await upgrade(socket, config);
          reader.attach();
          say(`EHLO ${config.heloName || "isp.local"}`);
          ehlo = await expect("EHLO after STARTTLS", 250);
        }
        say(`AUTH PLAIN ${Buffer.from(`\u0000${config.user}\u0000${config.password}`, "utf8").toString("base64")}`);
        await expect("AUTH", 235);
        say(`MAIL FROM:<${config.from}>`);
        await expect("MAIL FROM", 250);
        say(`RCPT TO:<${recipient}>`);
        await expect("RCPT TO", 250, 251);
        say("DATA");
        await expect("DATA", 354);
        socket.write(`${buildMessage({ from: config.from, fromName: config.fromName, to: recipient, subject: title, text, host: config.host })}\r\n.\r\n`);
        await expect("message", 250);
        say("QUIT");
      } finally {
        clearTimeout(timer);
        socket.end();
      }
    }
  };
}

function defaultConnect(config) {
  return new Promise((resolve, reject) => {
    const socket = config.port === 465
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.connect({ host: config.host, port: config.port });
    socket.once(config.port === 465 ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("error", () => reject(new MailSendError("connect")));
  });
}

function defaultUpgrade(socket, config) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: config.host });
    secure.once("secureConnect", () => resolve(secure));
    secure.once("error", () => reject(new MailSendError("TLS")));
  });
}

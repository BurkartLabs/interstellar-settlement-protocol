import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { buildMessage, createSmtpTransport, MailSendError, smtpConfigFromEnv } from "../../server/mailSmtpTransport.js";

// ISP-282 (AB#989): the SMTP transport, against a scripted server on a local socket. The real transport connects over
// TLS; here `connect` and `upgrade` are replaced, and `upgrade` marks the socket encrypted as tls.connect would.
const CONFIG = { host: "smtp.example.test", port: 587, user: "sender@example.test", password: "app-password-not-real", from: "sender@example.test", fromName: "Interstellar Settlement Protocol" };
const servers = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

/** A scripted SMTP server: `offerStartTls`, and `rcptCode` for the RCPT reply. Resolves to { port, log }. */
function fakeServer({ offerStartTls = true, rcptCode = 250 } = {}) {
  const log = [];
  let closedResolve;
  const closed = new Promise((resolve) => { closedResolve = resolve; });
  const server = net.createServer((sock) => {
    sock.on("close", () => closedResolve());
    let data = false;
    let buffer = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let at;
      while ((at = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (data) {
          log.push(`DATA> ${line}`);
          if (line === ".") { data = false; sock.write("250 queued\r\n"); }
          continue;
        }
        log.push(line);
        if (/^EHLO/.test(line)) sock.write(`250-fake\r\n${offerStartTls ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN\r\n`);
        else if (line === "STARTTLS") sock.write("220 go ahead\r\n");
        else if (/^AUTH PLAIN /.test(line)) sock.write("235 ok\r\n");
        else if (/^MAIL FROM/.test(line)) sock.write("250 ok\r\n");
        else if (/^RCPT TO/.test(line)) sock.write(`${rcptCode} ${rcptCode === 250 ? "ok" : "no such user"}\r\n`);
        else if (line === "DATA") { data = true; sock.write("354 go\r\n"); }
        else if (line === "QUIT") sock.end("221 bye\r\n");
      }
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, log, closed })));
}

const transportTo = (port) => createSmtpTransport(CONFIG, {
  connect: () => new Promise((resolve) => { const s = net.connect({ host: "127.0.0.1", port }, () => resolve(s)); }),
  upgrade: async (socket) => { socket.encrypted = true; return socket; }
});

describe("the SMTP transport (AB#989)", () => {
  it("upgrades to TLS before anything else, then authenticates and delivers one message", async () => {
    const { port, log, closed } = await fakeServer();
    await transportTo(port).send({ to: "player@example.test", subject: "Verify your email", text: "Open this link: https://isp.example/verify" });
    await closed; // everything the transport wrote has reached the server
    const commands = log.filter((l) => !l.startsWith("DATA> "));
    expect(commands.map((l) => l.split(" ")[0])).toEqual(["EHLO", "STARTTLS", "EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
    expect(commands[3]).toBe(`AUTH PLAIN ${Buffer.from("\u0000sender@example.test\u0000app-password-not-real").toString("base64")}`);
    expect(commands).toContain("RCPT TO:<player@example.test>");
    const body = log.filter((l) => l.startsWith("DATA> ")).map((l) => l.slice(6));
    expect(body).toContain("Subject: Verify your email");
    expect(body).toContain("To: <player@example.test>");
    const encoded = body.slice(body.indexOf("") + 1, body.indexOf(".")).join("");
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("Open this link: https://isp.example/verify");
  });

  it("sends nothing, not even the credentials, when the server does not offer TLS", async () => {
    const { port, log } = await fakeServer({ offerStartTls: false });
    await expect(transportTo(port).send({ to: "player@example.test", subject: "Hi", text: "x" })).rejects.toBeInstanceOf(MailSendError);
    expect(log.some((l) => /^AUTH/.test(l))).toBe(false);
    expect(log.some((l) => /^MAIL/.test(l))).toBe(false);
  });

  it("a refused recipient fails with the step and the code, and the error never names the address", async () => {
    const { port } = await fakeServer({ rcptCode: 550 });
    const error = await transportTo(port).send({ to: "nobody@example.test", subject: "Hi", text: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(MailSendError);
    expect([error.step, error.code]).toEqual(["RCPT TO", 550]);
    expect(String(error.message)).not.toContain("nobody@example.test");
  });

  it("refuses a recipient or a subject that would inject a header, before connecting", async () => {
    let connected = false;
    const t = createSmtpTransport(CONFIG, { connect: async () => { connected = true; throw new Error("no"); } });
    for (const bad of [{ to: "a@b.test\r\nBcc: c@d.test", subject: "x" }, { to: "a@b.test", subject: "Hi\r\nBcc: c@d.test" }, { to: "not an address", subject: "x" }]) {
      await expect(t.send({ ...bad, text: "x" })).rejects.toMatchObject({ step: "address" });
    }
    expect(connected).toBe(false);
  });

  it("encodes a subject that is not ASCII, and the body is base64", () => {
    const msg = buildMessage({ from: "a@b.test", fromName: "ISP", to: "c@d.test", subject: "Crédit reçu", text: "é", now: new Date(0) });
    expect(msg).toContain(`Subject: =?UTF-8?B?${Buffer.from("Crédit reçu").toString("base64")}?=`);
    expect(msg).toContain("Content-Transfer-Encoding: base64");
  });
});

describe("its configuration (AB#989)", () => {
  const full = { ISP_SMTP_HOST: "smtp.example.test", ISP_SMTP_PORT: "587", ISP_SMTP_USER: "u", ISP_SMTP_PASSWORD: "p", ISP_MAIL_FROM: "sender@example.test" };
  it("is complete or absent: any missing value means no transport, and mail fails closed", () => {
    expect(smtpConfigFromEnv(full)).toMatchObject({ host: "smtp.example.test", port: 587, from: "sender@example.test" });
    for (const key of ["ISP_SMTP_HOST", "ISP_SMTP_USER", "ISP_SMTP_PASSWORD", "ISP_MAIL_FROM"]) expect(smtpConfigFromEnv({ ...full, [key]: "" }), key).toBeNull();
    expect(smtpConfigFromEnv({ ...full, ISP_SMTP_HOST: "evil host\r\n" })).toBeNull();
    expect(smtpConfigFromEnv({ ...full, ISP_SMTP_PORT: "99999" })).toBeNull();
    expect(smtpConfigFromEnv({ ...full, ISP_SMTP_PORT: undefined }).port).toBe(465);
  });
});

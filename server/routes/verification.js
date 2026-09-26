// server/routes/verification.js: email verification's routes (AB#987, ISP-280), slice 1. Both are public: the person
// following a link or asking for a new one is, by definition, not signed in yet. Each answers without saying whether
// an address has an account.

import { DEV_SURFACE } from "../app.js";
import { resendVerificationLimiter } from "../rateLimiters.js";
import { accountByEmail, isEmailVerified, sendVerificationEmail, verifyEmailToken } from "../emailVerification.js";
import { mailAvailable, MailUnavailableError, testOutbox } from "../mail.js";

const RESEND_ANSWER = { message: "If that address has an account that still needs verifying, a new link is on its way." };
const MAIL_UNAVAILABLE = { error: "Email is not available on this server yet, so no link can be sent." };
const LINK_SPENT = { error: "This link has expired or was already used. Ask for a new one." };

export function registerVerificationRoutes(app) {
  app.post("/api/auth/verify-email", (req, res) => {
    const accountId = verifyEmailToken(req.body?.token);
    if (!accountId) {
      res.status(400).json(LINK_SPENT);
      return;
    }
    res.json({ verified: true });
  });

  app.post("/api/auth/resend-verification", resendVerificationLimiter, async (req, res) => {
    // Fails closed, and the same for every address: without a transport nothing can be sent to anyone.
    if (!(await mailAvailable())) {
      res.status(503).json(MAIL_UNAVAILABLE);
      return;
    }
    const account = accountByEmail(req.body?.email);
    if (account && !isEmailVerified(account.id)) {
      try {
        await sendVerificationEmail(account.id);
      } catch (error) {
        // Logged without the address or the link. The caller still gets the one answer, so a failure says nothing
        // about whether the address has an account.
        console.error("[verification] a verification email could not be sent:", error instanceof MailUnavailableError ? "no transport" : error?.name);
      }
    }
    res.status(202).json(RESEND_ANSWER);
  });

  // The test transport's outbox, for local play and the e2e specs: the only way to follow a link without a real
  // mailbox. Only where the demo account exists (ISP_DEV=1, never under NODE_ENV=production).
  if (DEV_SURFACE) {
    app.get("/api/dev/outbox", (_req, res) => {
      res.json({ messages: testOutbox().slice(-20) });
    });
  }
}

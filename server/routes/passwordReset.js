// server/routes/passwordReset.js: password reset's routes (AB#988, ISP-281). Both are public: the person resetting a
// password cannot sign in, which is the point. The request gives one answer for every address.

import { forgotPasswordAccountLimiter, forgotPasswordIpLimiter } from "../rateLimiters.js";
import { mailAvailable } from "../mail.js";
import { resetPassword, sendResetEmail } from "../passwordReset.js";

const REQUEST_ANSWER = { message: "If that address has an account, a link to reset its password is on its way. It works for one hour." };
const MAIL_UNAVAILABLE = { error: "Email is not available on this server yet, so no reset link can be sent." };
const LINK_SPENT = { error: "This link has expired or was already used. Ask for a new one." };

export function registerPasswordResetRoutes(app) {
  app.post("/api/auth/forgot-password", forgotPasswordIpLimiter, forgotPasswordAccountLimiter, async (req, res) => {
    // Fails closed, and the same for every address: without a transport nothing can be sent to anyone.
    if (!(await mailAvailable())) {
      res.status(503).json(MAIL_UNAVAILABLE);
      return;
    }
    try {
      await sendResetEmail(req.body?.email);
    } catch (error) {
      // Logged without the address; the caller gets the one answer, so a failure says nothing about the address.
      console.error("[password-reset] a reset email could not be sent:", error?.name);
    }
    res.status(202).json(REQUEST_ANSWER);
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const result = await resetPassword(req.body?.token, req.body?.password);
    if (result.ok) {
      res.json({ reset: true });
      return;
    }
    res.status(400).json(result.reason === "password" ? result.error : LINK_SPENT);
  });
}

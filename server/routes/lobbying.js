// server/routes/lobbying.js: lobbying campaigns (ISP-239, AB#934; docs/design/WARFARE.md, "Lobbying"). The register is
// public: lobbying is registered, so who opened a campaign and who pledged on which side is anyone's to read (never
// the amounts). Opening and pledging are the caller's own corporation's, spending its own standing and credits: the
// body's shape is checked by ACCOUNT_INPUT, and everything else (lobbyable, concedable, standing, holdings) here.
import { getAccountById, mutateAccountState } from "../gameState.js";
import { lobbyingOffice, lobbyingRegister, openCampaign, pledge } from "../lobbyingService.js";

export function registerLobbyingRoutes(app) {
  app.get("/api/lobbying", (req, res) => {
    res.json({ campaigns: lobbyingRegister() });
  });

  // ISP-240 (AB#935): the caller's lobbying office: its standing, the values in force, the register with its own pledges
  app.get("/api/accounts/:accountId/lobbying", (req, res) => {
    const corp = getAccountById(req.params.accountId)?.state?.corp;
    if (!corp) { res.status(404).json({ error: "Account not found." }); return; }
    res.json(lobbyingOffice(corp));
  });

  app.post("/api/accounts/:accountId/lobbying", (req, res) => {
    let result = null;
    const account = mutateAccountState(req.params.accountId, (state) => { result = openCampaign(state.corp, req.body || {}); });
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ ok: true, campaign: result.campaign, account });
  });

  app.post("/api/accounts/:accountId/lobbying/:campaignId/pledges", (req, res) => {
    let result = null;
    const account = mutateAccountState(req.params.accountId, (state) => { result = pledge(state.corp, String(req.params.campaignId), req.body || {}); });
    if (!account) { res.status(404).json({ error: "Account not found." }); return; }
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ ok: true, campaign: result.campaign, account });
  });
}

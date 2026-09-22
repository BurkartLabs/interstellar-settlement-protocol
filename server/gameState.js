// server/gameState.js: the game's state, rules and persistence, split by system into server/game/*.js (AB#737).
// This file only re-exports, so every existing import of it keeps working. New code imports the module it needs.

export { BASE_MAX_PROBES, CEO_INSIGHT_LIBRARY, MAX_DEFINED_LEVEL, MILESTONE_LEVELS, REFINERY_CHAINS, SYSTEM_DETAILS, dataDir, getStationInventory } from "./game/catalog.js";
export { PLAYER_BUILDINGS, STAT_KEYS, bumpStat, evaluateLevelProgress, fleetRaiseText, fleetStatus, getEffectiveExchangeTaxRate, levelReachedNotices, onAccountNotification } from "./game/progression.js";
export { applyMiningOperations, extractorDowntimeProbPerSec, startExtractorCycle } from "./game/mining.js";
export { applyRefineryOperations } from "./game/refining.js";
export { BASE_MAX_DEPLOYMENTS, BELT_COMPOSITIONS, EXPEDITION_DURATIONS, EXPEDITION_LAUNCH_COST, PROBE_ASSET_VALUE, PROBE_BUILD_COST, PROBE_FABRICATION_MS, applyAsteroidExpeditions, splitExactly } from "./game/asteroids.js";
export { COMPLETED_COOLDOWN_MS, FIRST_CONTRACT_ID, MISSION_TEMPLATES, refreshContractOfferings } from "./game/corporation.js";
export { CHAT_CHANNELS, FORUM_CATEGORIES, NPC_BUY_SEED, RESERVED_CORPORATION_NAMES, ensureGlobalSocialState, freshGlobalState, normalizeGlobalState } from "./game/world.js";
export { accountExists, addAccountNotification, appendChatMessage, authenticateAccount, backfillCorpPublicIds, createAccount, createCombatReport, getAccountById, getAllAccountIds, getDummyAccount, getState, getStatements, hasRefreshToken, listAccountNotifications, markAllNotificationsRead, markNotificationRead, markWalkthroughCompleted, mergeDummyAccount, mutateAccountState, mutateState, resetDummyAccountProgress, resetWalkthroughCompletion, revokeRefreshToken, saveAccountsNow, settleAccountPayroll, storeRefreshToken, storedCombatReportSummary } from "./game/store.js";
export { CORP_NAME_MAX_LENGTH, addSystemMessageToAccount, deleteDraft, findCorporations, listAccountMessages, markMessageRead, moveMessage, resolveMailRecipient, saveDraft, sendPlayerMessage } from "./game/messaging.js";

// AB#738 (ISP-52): the page's one shared state object and the constants every module reads. `appState` is a
// single object mutated in place, never reassigned, so every importer sees the same state.
import { loadExchangeView } from "./exchangeView.js";

/** localStorage, or null where reading the property itself throws (sandboxed frames, some private modes). */
export function viewerStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const appState = {
  serverData: null,
  /** The economy's constants from /api/bootstrap (ISP-86): what an hour of mining costs and what ore fetches. */
  economy: null,
  data: null,
  authenticated: false,
  accountId: null,
  accountEmail: null,
  /** AB#757: in memory only, never in storage; the refresh token is an HttpOnly cookie this page cannot see. */
  accessToken: null,
  profileMode: null,
  walkthroughCompleted: false,
  textOnly: false,
  chatChannel: "global",
  chatOwnLinePending: false, // Bug #1135: the player just sent a line, so the next redraw shows the newest
  mapMounted: false,
  walkthroughIndex: 0,
  activeTypewriter: null,
  feedbackLog: [],
  notifications: [],
  unreadNotifications: 0,
  selectedForumThreadId: null,
  completedRequirementIds: new Set(),
  requirementsInitialized: false,
  forumsView: "overview",
  selectedForumCategory: null,
  missionsView: "board",
  selectedMissionId: null,
  selectedAgentId: null,
  activeMissions: [],
  // Persists user-edited refinery quantity so re-renders (every tick) don't
  // overwrite what the user is typing.
  refineQuantityOverrides: {},
  refineQuantityErrors: {}, // AB#1255: why Start Run refused a chain's quantity, shown under its field until it is edited
  listingStatus: null, // AB#2057: { item, tone, text }, what Create Listing last said, shown in that item's row
  miningUiTicker: null,
  stationRegistry: [],
  buildingRegistry: [],
  insightPrograms: [], // loaded from /api/ceo-insight (Bug #983)
  stationActiveLease: null,
  _travelTimer: null,
  exchangeView: loadExchangeView(viewerStorage()), // resource, order type and sort, remembered per viewer (AB#402)
  beltCompositions: {},
  inbox: {
    messages: [],
    folder: "inbox",          // active folder tab
    subtype: "official",      // active inbox sub-tab: "official" | "players"
    openMessageId: null,      // message being viewed in detail
    composeDraftId: null,     // draft being edited
    loaded: false
  }
};

export const STORAGE_KEYS = {
  accountId: "isp.accountId",
  walkthroughOfferSeenPrefix: "isp.walkthrough-offer-seen:"
};

export const LOGIN_PAGE_PATH = "/login.html";

export const IS_DEV_ACCESS =
  new URL(window.location.href).searchParams.get("dev") === "1" ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

// AB#1049: fetched from GET /api/research (loadStationRegistry, below) instead of redefined here. `const` and
// populated by mutation (`techTree.push(...)`), never reassigned — createStarmapController below captures this
// exact array by reference at module load, before the boot fetch resolves, so replacing the binding would leave
// the starmap's travel-research-lock text reading a permanently empty tree.
export const techTree = [];

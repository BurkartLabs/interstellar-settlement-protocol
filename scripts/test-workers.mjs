/**
 * How much of the machine one test run may take (AB#2144). vitest.config.js and playwright.config.js read these, so
 * the numbers live in one committed place rather than on a command line a session can forget.
 *
 * Several Builder panes run their suites on one PC at once, this repo's and other products'. vitest's default is a
 * worker per core less one and Playwright's is half the cores, each sized for an idle machine; together they
 * oversubscribe it, and a server boot outlasts its beforeAll or a test outlasts its timeout (Bugs #2051, #2055).
 * Raising the timeouts again would only make the same failure slower. Bounding each run leaves room for the others.
 */

/** vitest: half the cores. */
export const VITEST_MAX_WORKERS = "50%";

/** Playwright: a quarter of the cores, since every worker drives its own Chromium. */
export const PLAYWRIGHT_WORKERS = "25%";

// Ensure deterministic, isolated test environment.
import fs from "node:fs";
import path from "node:path";

// Never read the developer's data/state.json or accounts-snapshot.json: they are gitignored runtime output, so a suite
// that read them passed or failed on what the local server last wrote (Bug #588). Each test file gets an empty data
// directory of its own under the run's root, which tests/globalSetup.js creates and removes (Bug #578: the server
// writes there like any install, instead of pretending to be serverless to skip the writes).
const root = process.env.ISP_TEST_DATA_ROOT;
if (!root) throw new Error("tests/globalSetup.js did not set ISP_TEST_DATA_ROOT");
process.env.ISP_DATA_DIR = fs.mkdtempSync(path.join(root, "file-"));

// The server always listens (Bug #578); port 0 takes any free one, so test files never collide.
process.env.PORT = "0";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-prod";
// Tests import server/index.js for supertest / socket tests. This flag stops
// the 8 setInterval ticker registrations so the test process can exit cleanly.
process.env.ISP_DISABLE_TICKERS = "1";
// Allow the dummy-login routes during tests.
process.env.ISP_DEV = "1";

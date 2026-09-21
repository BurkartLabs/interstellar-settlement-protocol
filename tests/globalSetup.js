// One temporary root for the run's data directories (tests/setup.js makes one per test file), removed when the run
// ends, after every worker has stopped.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isp-test-data-"));
  process.env.ISP_TEST_DATA_ROOT = root;
  return () => fs.rmSync(root, { recursive: true, force: true });
}

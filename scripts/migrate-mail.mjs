// node scripts/migrate-mail.mjs (AB#910): copy the old player mail in the data directory's accounts snapshot into
// conversations (docs/design/messaging.md, "Migrating today's player mail"). Run once per environment, with the server
// stopped so the snapshot is not being rewritten underneath it; running it again copies nothing twice.
//
// It leaves the old mail where it is (the Inbox reads it until it moves to conversations) and prints the counts. It
// exits 1 if any old player message between two existing corporations is not in a conversation afterwards.
import { accountsStore } from "../server/game/store.js";
import { dataDir } from "../server/game/catalog.js";
import { migrateLegacyMail } from "../server/game/conversations.js";

try {
  const report = migrateLegacyMail(accountsStore);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Old player mail: ${report.copies} copies, ${report.messages} distinct messages.`);
  console.log(`Written to conversations: ${report.written}. Already there: ${report.alreadyPresent}. Skipped (a side no longer exists): ${report.skippedMissingAccount}.`);
} catch (error) {
  console.error(`Migration did not finish: ${error?.message || error}`);
  process.exit(1);
}

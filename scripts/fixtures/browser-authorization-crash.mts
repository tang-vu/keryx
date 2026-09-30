import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "../../lib/db/sqlite-adapter";
import { validateStorageIdentity } from "../../lib/db/storage-identity";
import { assertStorageFences, assertStorageIdentity, registerStorageCapability } from "../../lib/db/storage-identity-sqlite";
import type { BrowserJournalAdmission } from "../../lib/db/browser-authorization-journal";

// Synthetic subprocess fixture. Never loads environment files or accesses a provider.
const [file, boundary, encodedInput, encodedIdentity] = process.argv.slice(2);
const input = JSON.parse(encodedInput) as BrowserJournalAdmission;
const expectedIdentity = validateStorageIdentity(JSON.parse(encodedIdentity));
const db = new SqliteAdapter(file, { expectedIdentity });
await db.init();
if (boundary === "before_commit") {
  const raw = new DatabaseSync(file);
  // Test-only crash injection uses the explicitly supplied identity, never a marker-adopted identity.
  assertStorageIdentity(raw, expectedIdentity); assertStorageFences(raw, expectedIdentity);
  registerStorageCapability(raw, expectedIdentity, () => true);
  raw.function("crash_boundary", () => {
    process.send?.({ boundary });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
    throw new Error("parent did not kill the fixture");
  });
  raw.exec(
    "CREATE TRIGGER crash_before_payment BEFORE INSERT ON payment_events BEGIN SELECT crash_boundary(); END"
  );
  const { admitSqliteBrowserJournal } = await import(
    "../../lib/db/sqlite-browser-journal"
  );
  admitSqliteBrowserJournal(raw, input);
} else {
  const admitted = await db.admitBrowserJournal(input);
  if (admitted.status !== "admitted")
    throw new Error("synthetic admission refused");
  if (boundary !== "prepared")
    await db.exposeBrowserJournal(input.sessionId, input.requestId);
  if (["signed", "submission_attempted"].includes(boundary)) {
    await db.signBrowserJournal(input.sessionId, input.requestId, {
      validAfter: "1",
      validBefore: "2000000000",
      headerHash: "a".repeat(64),
    });
  }
  if (boundary === "submission_attempted")
    await db.submitBrowserJournal(input.sessionId, input.requestId);
  process.send?.({ boundary });
  await new Promise(() => setInterval(() => undefined, 30_000));
}

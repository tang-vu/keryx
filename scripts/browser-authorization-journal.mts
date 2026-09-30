import { config } from "../lib/config";
import { getDb } from "../lib/db";

// Operator command. Loads only the environment explicitly supplied by the operator's Node flags.
// Schema installation deliberately leaves the journal inactive.
const args = new Set(process.argv.slice(2));
const supported = new Set([
  "--activate",
  "--confirm-old-writers-drained",
  "--pending",
]);
if ([...args].some((arg) => !supported.has(arg)))
  throw new Error("Unsupported journal command argument");
if (config.networkId !== "eip155:5042002")
  throw new Error("Browser journal cutover is authorized for Arc testnet only");
const db = await getDb();
if (args.has("--activate")) {
  if (!args.has("--confirm-old-writers-drained")) {
    throw new Error(
      "Activation requires confirmed replacement and drain of every old browser writer"
    );
  }
  await db.activateBrowserJournal();
}
console.log(
  JSON.stringify({ browserJournalActive: await db.browserJournalActive() })
);
if (args.has("--pending")) {
  const rows = await db.listPendingPayments(100);
  console.log(
    JSON.stringify(
      rows
        .filter((row) => row.grantEpoch)
        .map((row) => ({
          nonce: row.authorizationId,
          phase: row.authorizationPhase ?? "legacy_unknown",
          grantEpoch: row.grantEpoch,
          amountUsdc: row.amountUsdc,
          createdAt: row.createdAt,
          authorizationExpiresAt: row.authorizationExpiresAt ?? null,
          lastEvidence: row.txHash ?? null,
        }))
    )
  );
}

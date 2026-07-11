/**
 * check-registry.mts — registry parity watchdog. Reads EVERY record off the on-chain
 * SourceRegistry and field-compares the money-path columns (payout wallet, author splits,
 * fetch price, active flag) against the DB cache the agent actually pays from.
 *
 * The one-off audit that ran when the registry was switched on proved parity once; this
 * makes it continuous. A mismatch means indexer drift or a tampered cache — either way the
 * agent could be paying the wrong wallet, so it alerts rather than logs. The compact summary
 * lands in sync_state (PARITY_STATE_KEY) where /api/health serves it to the /status page.
 *
 * Run:  npm run check-registry     (wired hourly via cron in deploy-vps.sh)
 * Exit: 0 parity holds · 1 issues found (alert fired) · 2 the check itself failed
 * Env:  KERYX_ALERT_WEBHOOK — Discord/Slack webhook for the alert (optional; logs regardless)
 */

import { config } from "../lib/config.ts";
import { getDb } from "../lib/db/index.ts";
import { sendAlert } from "../lib/notify/alert.ts";
import {
  auditRegistryParity,
  chainRegistryReader,
  summarize,
  PARITY_STATE_KEY,
} from "../lib/registry/parity.ts";

async function main(): Promise<void> {
  if (!config.registryReadAddress) {
    console.log("[registry] no registry address configured — offline/DB-direct mode, nothing to audit.");
    return;
  }

  const db = await getDb();
  const report = await auditRegistryParity(db, chainRegistryReader());

  const lag =
    report.lastSyncedBlock !== null
      ? `indexed block ${report.lastSyncedBlock} / head ${report.headBlock}`
      : `indexer has no checkpoint yet (head ${report.headBlock})`;
  console.log(
    `[registry] ${config.registryReadAddress} — ${report.comparedCount}/${report.chainCount} records read back, ${lag}`,
  );

  // Persist the summary BEFORE deciding health — /status should show a failing check too.
  await db.setSyncState(PARITY_STATE_KEY, JSON.stringify(summarize(report)));

  if (report.issues.length === 0) {
    console.log(`[registry] OK — cache matches the chain on all ${report.comparedCount} records.`);
    return;
  }

  for (const issue of report.issues) {
    console.error(
      `[registry] MISMATCH ${issue.field} on ${issue.rowId ?? issue.onchainId}: chain=${issue.chain} cache=${issue.cache}`,
    );
  }
  const worst = report.issues
    .slice(0, 5)
    .map((i) => `${i.field}@${(i.rowId ?? i.onchainId).slice(0, 18)}`)
    .join(", ");
  // A far-behind checkpoint changes the diagnosis: rows may simply not be indexed yet —
  // or the indexer is stalled. Either way say so, instead of implying tampering.
  const behind =
    report.lastSyncedBlock !== null
      ? BigInt(report.headBlock) - BigInt(report.lastSyncedBlock)
      : null;
  const lagNote =
    behind !== null && behind > BigInt(100)
      ? ` NOTE: the indexer is ${behind} blocks behind head — mismatches may be catch-up lag, or a stalled indexer.`
      : "";
  await sendAlert(
    `registry parity broken (${report.issues.length} issue${report.issues.length === 1 ? "" : "s"})`,
    `cache disagrees with SourceRegistry on: ${worst}. The agent may be paying wallets the chain never authorized — run \`npm run check-registry\` on the box for the full diff.${lagNote}`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[registry] check failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});

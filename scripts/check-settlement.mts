/**
 * check-settlement.mts — settlement parity watchdog. Takes every wallet Keryx has ever paid and
 * asks Circle what it actually holds for that address, then publishes both figures side by side.
 *
 * Citation payouts settle inside Circle's Gateway, so their receipt is a Circle transfer id rather
 * than an EVM hash — there is no block explorer page to open. What there IS, is a public
 * unauthenticated balance API: a third party that will confirm, address by address, that the money
 * Keryx says it moved is really sitting where Keryx says it is. That is the check this runs, and
 * /status publishes the result.
 *
 * Only a SHORTFALL alerts. A creator's Gateway balance is their own account — they can deposit into
 * it and be paid into it by any other x402 service — so holding more than Keryx accounts for is
 * expected and silent. Holding less is the one direction that means Keryx overstated a payout.
 *
 * Being their own account also means they can empty it without telling us, so a wallet that comes
 * up short gets a second reading: its plain on-chain USDC balance. Money that merely moved from the
 * Gateway to its owner is still accounted for and is reported as a cash-out, not a discrepancy.
 * Only a gap that survives both readings is worth waking anyone for.
 *
 * Run:  npm run check-settlement    (wired hourly via cron in deploy-vps.sh)
 * Exit: 0 parity holds · 1 a wallet is short (alert fired) · 2 the check itself failed
 * Env:  KERYX_ALERT_WEBHOOK — Discord/Slack webhook for the alert (optional; logs regardless)
 */

import { getDb } from "../lib/db/index.ts";
import { getGatewayHeldUsdc } from "../lib/gateway/gateway-balance.ts";
import { getOnchainUsdcBalances } from "../lib/gateway/onchain-usdc-balance.ts";
import { sendAlert } from "../lib/notify/alert.ts";
import {
  labelAccounts,
  reconcileSettlement,
  summarizeSettlement,
  SETTLEMENT_PARITY_STATE_KEY,
} from "../lib/gateway/settlement-parity.ts";

const usd = (n: number) => `$${n.toFixed(6)}`;

async function main(): Promise<void> {
  const db = await getDb();

  // Ledger FIRST, balances second. Settlement never stops, so whichever side is read later is the
  // newer number; this order means a payment landing mid-check can only make Circle look richer
  // than the claim — the harmless direction. Reversed, every busy minute would invent a shortfall.
  const [ledger, sources] = await Promise.all([db.settlementLedger(), db.listSources()]);
  if (ledger.length === 0) {
    console.log("[settlement] no settled payouts on file — nothing to reconcile.");
    return;
  }

  const labelled = labelAccounts(ledger, sources);
  const held = await getGatewayHeldUsdc(labelled.map((a) => a.address));
  const checkedAt = new Date().toISOString();

  // Second reading, for the shortfalls only: a Gateway balance is the creator's own account, so
  // money that left it has usually just moved to their wallet — through Circle's CLI or any other
  // tool that signs for them, none of which write a row here. Reading the chain for those few
  // addresses separates "the creator cashed out" from "Keryx overstated a payout".
  const firstPass = reconcileSettlement(labelled, held, checkedAt);
  const onchain =
    firstPass.issues.length > 0
      ? await getOnchainUsdcBalances(firstPass.issues.map((a) => a.address))
      : new Map<string, number | null>();
  const report = reconcileSettlement(labelled, held, checkedAt, onchain);

  const cashed =
    report.cashedOutUsdc > 0
      ? `; ${usd(report.cashedOutUsdc)} already cashed out to creators' own wallets`
      : "";
  console.log(
    `[settlement] ${report.accounts.length} wallet(s) with a live claim — ledger says ${usd(report.owedUsdc)} still held; Circle confirms ${usd(report.confirmedUsdc)}${cashed}.`,
  );
  for (const a of report.accounts) {
    const label = a.label ?? a.address;
    const heldStr = a.heldUsdc === null ? "unanswered" : usd(a.heldUsdc);
    const chain = typeof a.onchainUsdc === "number" ? ` · wallet ${usd(a.onchainUsdc)}` : "";
    console.log(
      `  ${a.verdict.padEnd(9)} ${label.slice(0, 42).padEnd(42)} claim ${usd(a.owedUsdc).padStart(11)} · gateway ${heldStr}${chain}`,
    );
  }

  // Persist BEFORE deciding health — /status should show a failing check, not an empty section.
  await db.setSyncState(SETTLEMENT_PARITY_STATE_KEY, JSON.stringify(summarizeSettlement(report)));

  if (report.counts.unknown > 0) {
    // Not a failure: Circle or the Arc RPC being unreachable says nothing about the money. Worth
    // printing, since it also means `confirmedUsdc` understates what is really backed.
    console.log(
      `[settlement] ${report.counts.unknown} wallet(s) could not be fully verified (Circle or Arc RPC unanswered).`,
    );
  }

  if (report.counts.unknown === report.accounts.length) {
    // Nothing was checked, so "no shortfall found" is not a clean bill of health — say so plainly
    // rather than let a silent Circle read as confirmation.
    console.log("[settlement] nothing fully verified this run; an evidence provider did not answer.");
    return;
  }

  if (report.issues.length === 0) {
    console.log(
      `[settlement] OK — every answered wallet accounts for what Keryx claims, in the Gateway or in the creator's own wallet.`,
    );
    return;
  }

  for (const a of report.issues) {
    console.error(
      `[settlement] SHORT ${a.label ?? a.address} (${a.address}): claim ${usd(a.owedUsdc)} · gateway ${usd(a.heldUsdc ?? 0)} · missing ${usd(-(a.deltaUsdc ?? 0))}`,
    );
  }
  const worst = report.issues
    .slice(0, 5)
    .map((a) => `${(a.label ?? a.address).slice(0, 24)} −${usd(-(a.deltaUsdc ?? 0))}`)
    .join(", ");
  await sendAlert(
    `settlement parity short (${report.issues.length} wallet${report.issues.length === 1 ? "" : "s"})`,
    `Neither Circle's Gateway nor the wallet itself holds what the payout ledger claims for: ${worst}. A self-service cash-out is already ruled out (the on-chain balance was read too), so this is a payout recorded that never settled — run \`npm run check-settlement\` on the box for the full table.`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[settlement] check failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});

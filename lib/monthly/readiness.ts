import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { assertMainnetHostedResearchReady } from "../payments/mainnet-hosted-gateway";
import { quoteResearchMonthly } from "./quote";
import { configuredResearchAllowance } from "../research/research-allowance";

export function monthlyConfigured() {
  return process.env.KERYX_MONTHLY_ENABLED === "1" && !!config.sellerAddress
    && process.env.KERYX_FORCE_OFFLINE !== "1" && (!config.profile.testnet || !!config.funderKey);
}

/** Current per-run capacity and actual custody, not escrow for four future jobs. */
export async function assertMonthlyExecutionReady(db: KeryxDB, creatorBudgetMicros: number) {
  if (configuredResearchAllowance()) throw new Error("Monthly admission is paused during bounded browser acceptance");
  await db.assertResearchPurchaseAuthority(config.profile.networkId);
  if (!config.profile.testnet) await assertMainnetHostedResearchReady(db, String(creatorBudgetMicros));
}

/** Native writer admission precedes quote issuance and all payment exposure. */
export async function monthlyAdmissionQuote(db: KeryxDB) {
  if (configuredResearchAllowance()) throw new Error("Monthly admission is paused during bounded browser acceptance");
  if (!monthlyConfigured()) throw new Error("Monthly unavailable");
  await db.assertResearchPurchaseAuthority(config.profile.networkId);
  const quote = quoteResearchMonthly();
  if (!config.profile.testnet) await assertMainnetHostedResearchReady(db, String(quote.creatorBudgetMicros));
  return quote;
}

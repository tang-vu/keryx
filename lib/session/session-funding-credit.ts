import { z } from "zod";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { readBoundedJson } from "../read-bounded-json";
import type { FundingRecord } from "../buyer/funding-policy";

const micros = z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
const time = z.string().datetime().refine(value => new Date(value).toISOString() === value);
export const sessionFundingCreditSchema = z.object({ status: z.literal("known"), network: z.literal(profile.networkId),
  address: z.string().regex(/^0x[0-9a-f]{40}$/), available: micros, observedAt: time,
  accountingAuthority: z.literal("original-admitted-settled-v1"), hasAuthorityHistory: z.boolean(),
  confirmedSpentMicroUsdc: micros, retainedSpentMicroUsdc: micros, postBaselineConfirmedDebitMicroUsdc: micros,
  debitBaselineObservedAt: time.optional(),
}).strict().refine(value => BigInt(value.confirmedSpentMicroUsdc) <= BigInt(value.retainedSpentMicroUsdc) &&
  BigInt(value.postBaselineConfirmedDebitMicroUsdc) <= BigInt(value.confirmedSpentMicroUsdc) &&
  (value.hasAuthorityHistory || value.retainedSpentMicroUsdc === "0"), "Original debit projection refused");
export type SessionFundingCredit = z.infer<typeof sessionFundingCreditSchema>;

/** Authenticated original-journal projection. Public balance lookup cannot establish this offset. */
export async function readOwnerSessionCredit(signer: string, grantEpoch?: string | null, after?: string) {
  const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(signer).toLowerCase();
  const query = new URLSearchParams({ address, accounting: "original-v1" });
  if (grantEpoch) query.set("grantEpoch", z.string().uuid().parse(grantEpoch));
  if (after) query.set("after", time.parse(after));
  const response = await fetch(`/api/session/credit?${query}`, { credentials: "same-origin", redirect: "error", cache: "no-store",
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel(); throw new Error("Original Gateway funding credit is unavailable; retain the deposit for recovery");
  }
  const value = sessionFundingCreditSchema.parse(await readBoundedJson(response, 8192));
  if (value.address !== address || value.debitBaselineObservedAt !== after) throw new Error("Original funding credit selector differs");
  return value;
}

/** Later confirmation of an older authorization is never evidence that a deposit arrived. */
export function hasOriginalSessionDepositCredit(row: FundingRecord, available: bigint, projection?: unknown) {
  if (!row.depositor || row.gatewayCreditBefore === undefined || available < BigInt(0)) return false;
  let offset = BigInt(0);
  if (projection !== undefined) {
    const evidence = sessionFundingCreditSchema.parse(projection);
    if (row.network !== profile.networkId || evidence.address !== row.depositor.toLowerCase() || evidence.available !== available.toString() ||
      !row.gatewayCreditObservedAt || evidence.debitBaselineObservedAt !== row.gatewayCreditObservedAt ||
      Date.parse(evidence.observedAt) < Date.parse(row.gatewayCreditObservedAt)) throw new Error("Original funding credit evidence differs");
    offset = BigInt(evidence.postBaselineConfirmedDebitMicroUsdc);
  }
  return available + offset >= BigInt(row.gatewayCreditBefore) + BigInt(row.amount);
}

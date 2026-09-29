import type { FundingRecord } from "./funding-policy";

export type FundingReadiness = "ready" | "deposit-unverified" | "insufficient" | "unavailable";

/** A receipt proves an Arc call, while only current Gateway credit can cover a purchase. */
export function fundingReadiness(availableMicros: string | null, requiredMicros: string, records: FundingRecord[], lookupFailed = false): FundingReadiness {
  if (lookupFailed) return "unavailable";
  if (availableMicros !== null && BigInt(availableMicros) >= BigInt(requiredMicros)) return "ready";
  // Only the newest funding plan can explain a currently unverified credit lookup.
  // A known shortfall remains a shortfall even after a historical successful deposit.
  if (availableMicros === null && records[0]?.deposit.status === "confirmed" && !records[0].cancelled) return "deposit-unverified";
  return availableMicros === null ? "unavailable" : "insufficient";
}

export function hasUncertainFunding(records: FundingRecord[]): boolean {
  return records.some(record => record.activePayer && (["possible", "submitted"].includes(record.approval.status)
    || ["possible", "submitted"].includes(record.deposit.status)));
}

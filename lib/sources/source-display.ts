import type { RegistryEntry } from "./source-directory";

/** Historical eligibility flags and registry registration cannot certify current control. */
export function publisherControlLabel(entry: Pick<RegistryEntry, "source" | "claim" | "claimPolicyUnavailable" | "controlFresh">): string {
  if (entry.claimPolicyUnavailable) return "Publisher control unavailable";
  if (entry.claim) return entry.controlFresh ? "Publisher control verified" : "Publisher control expired";
  if (entry.source.verified === false) return "Publisher control unverified";
  return "Current publisher proof not shown";
}

export function safePublisherUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

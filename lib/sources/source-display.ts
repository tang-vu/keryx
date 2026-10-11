import type { RegistryEntry } from "./source-directory";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en");

/** Historical eligibility flags and registry registration cannot certify current control. */
export function publisherControlLabel(entry: Pick<RegistryEntry, "source" | "claim" | "claimPolicyUnavailable" | "controlFresh">): string {
  if (entry.claimPolicyUnavailable) return copy("sourceRegistry.controlUnavailable");
  if (entry.claim) return entry.controlFresh ? copy("publisherControl.verified") : copy("publisherControl.expired");
  if (entry.source.verified === false) return copy("sourceRegistry.unverified");
  return copy("publisherControl.proofMissing");
}

export function safePublisherUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

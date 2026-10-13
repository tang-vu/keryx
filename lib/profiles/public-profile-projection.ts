import type { QueryRun, Citation } from "../types";
import { parseRunProvenance } from "../research/run-provenance";
import { parseRunUsage } from "../research/usage-provenance";
import { publicProfileRun } from "./public-profile";

/** Exact decimal admission, never rounding an invalid/partial amount into credit. */
export function recordedMicros(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!match) return null;
  return (BigInt(match[1]) * BigInt(1000000) + BigInt((match[2] ?? "").padEnd(6, "0"))).toString();
}
export function publicCitationUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 2048) return;
  try { const url = new URL(raw); if (url.protocol === "https:" && !url.username && !url.password && !url.search) return url.href; } catch { /* No fetch or guessed replacement URL. */ }
}
/** Closed projection: no answer, trace, payer, owner wallet, nonce, original fulfillment or claim credential. */
export type PublicRunSource = Pick<QueryRun,"id"|"question"|"createdAt"|"provenance"|"usage"|"paymentMode"|"fundingOwner"|"askerFunded"> & {
  citations: Array<Pick<Citation,"marker"|"sourceName"|"itemUrl">>;
};
export function publicRun(run: PublicRunSource, claimed: boolean, ledgerNetworks: string[]) {
  const provenance = parseRunProvenance(run.provenance), usage = parseRunUsage(run.usage);
  const networks = new Set(ledgerNetworks.filter(value => value === "eip155:5042" || value === "eip155:5042002"));
  if (usage) networks.add(usage.network);
  const network = networks.size === 1 && ledgerNetworks.every(value=>value==="eip155:5042"||value==="eip155:5042002") ? [...networks][0] : null;
  return publicProfileRun.parse({ id: run.id, question: run.question, createdAt: run.createdAt,
    surface: provenance?.surface ?? "unknown", network,
    funding: run.paymentMode === "offline" || run.fundingOwner === "offline" ? "simulation"
      : run.fundingOwner === "treasury" ? "sponsored"
      : run.fundingOwner === "browser" || run.askerFunded === true ? "reader-funded"
      : usage?.payment === "sponsored" ? "sponsorship-recorded" : "unknown",
    ownership: claimed ? "claimed" : provenance?.ownershipMethod === "unknown" || !provenance ? "recorded-unknown" : provenance.ownershipMethod,
    citations: run.citations.map(citation => ({ marker: citation.marker, sourceName: citation.sourceName,
      ...(publicCitationUrl(citation.itemUrl) ? { itemUrl: publicCitationUrl(citation.itemUrl) } : {}) })),
    reportPath: `/dispatch/${run.id}`, receiptsPath: `/api/dispatch/${run.id}/receipt` });
}

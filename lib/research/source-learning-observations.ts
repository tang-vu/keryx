import type { QueryRun, Source, PaymentRecord } from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";
import { topicTokens } from "../answers-topics";
import { parseRunUsage } from "./usage-provenance";
import { parseRunProvenance } from "./run-provenance";
import { scorePurchases } from "../research-audit/purchase-outcomes";
import { sourceLearningSnapshotSchema, type SourceLearningSnapshot } from "./source-learning-contract";

/** Public tags only: never persist a question's names, URLs or arbitrary vocabulary as public facets. */
export function sourceLearningTopics(source: Pick<Source, "tags">, question: string): string[] {
  const asked = topicTokens(question);
  const tags = [...new Set(source.tags.flatMap(tag => [...topicTokens(tag)]))]
    .filter(tag => /^[a-z0-9]{3,40}$/.test(tag) && asked.has(tag)).sort().slice(0, 12);
  return tags.length ? tags : ["general"];
}

/** Write-time server observation only. No classifier, ownership discovery, signing or purchase. */
export function captureSourceLearning(input: { run: QueryRun; sources: readonly Source[];
  terms: ReadonlyMap<string, SourceFetchTerms | readonly SourceFetchTerms[]>; payments: readonly PaymentRecord[];
  readSourceIds: ReadonlySet<string>; readAssetIds: ReadonlySet<string> }): SourceLearningSnapshot {
  const { run } = input;
  const usage = parseRunUsage(run.usage), provenance = parseRunProvenance(run.provenance);
  if (!usage) throw new Error("Source learning requires write-time network provenance");
  const actor = provenance && provenance.ownershipMethod !== "unknown" && /^0x[a-fA-F0-9]{40}$/.test(run.asker ?? "")
    ? run.asker!.toLowerCase() : undefined;
  let purchases: ReturnType<typeof scorePurchases>["purchases"] = [];
  try { purchases = scorePurchases(run, input.payments, usage.network).purchases; } catch { /* Unscorable observations confer no purchased outcome. */ }
  const seen = new Set<string>();
  const rows: SourceLearningSnapshot["sources"] = [];
  for (const source of input.sources.slice(0, 100)) {
    if (seen.has(source.id) || source.id.startsWith("public:")) continue;
    seen.add(source.id);
    const stored = input.terms.get(source.id);
    const terms: readonly SourceFetchTerms[] = stored ? "authority" in stored ? [stored] : stored : [];
    const owners = [source.walletAddress, ...source.authors.map(a => a.walletAddress),
      ...terms.flatMap(t => [t.creator, t.payTo, ...(t.citationWallets ?? [])]),
      ...input.payments.filter(p => p.queryId === run.id && p.sourceId === source.id && p.network === usage.network).map(p => p.payee)];
    // Known beneficiaries and registrants are excluded even before cohort or settlement checks.
    const eligibility: SourceLearningSnapshot["sources"][number]["eligibility"] = actor && owners.some(owner => owner.toLowerCase() === actor) ? "owner"
      : source.evidenceProvenance === "synthetic-demo" ? "synthetic"
      : run.paymentMode !== "real" ? "offline"
      : !actor || usage.cohort === "unknown" ? "unknown"
      : usage.cohort !== "outside" || usage.payment !== "independent" ? "non-independent"
      : terms.length === 0 || terms.some(t => t.authority !== "onchain" || t.stale || !t.active)
        || owners.some(owner => !/^0x[a-fA-F0-9]{40}$/.test(owner)) ? "authority-unavailable" : "eligible";
    const bought = purchases.filter(p => p.sourceId === source.id && input.readSourceIds.has(source.id) && input.readAssetIds.has(p.assetId));
    const cited = bought.some(p => p.cited);
    rows.push({ sourceId: source.id, topics: sourceLearningTopics(source, run.question), eligibility,
      read: input.readSourceIds.has(source.id), cached: run.decisions.some(d => d.sourceId === source.id && d.action === "CACHE") && input.readSourceIds.has(source.id),
      bought: bought.length > 0, cited, accessMicros: bought.reduce((sum, p) => sum + BigInt(p.settledAccessMicros), BigInt(0)).toString(),
      contribution: cited ? Math.min(1, bought.reduce((sum, p) => sum + p.contributionWeight, 0)) : 0 });
  }
  return sourceLearningSnapshotSchema.parse({ version: 1, network: usage.network, sources: rows });
}

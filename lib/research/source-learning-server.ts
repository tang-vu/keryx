import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { parseRunUsage } from "./usage-provenance";
import { parseRunProvenance } from "./run-provenance";
import { sourceLearningId, parseSourceLearningSnapshot, validateSourceLearningReport,
  SOURCE_LEARNING_SCAN, SOURCE_LEARNING_SAMPLE, type SourceLearningReport } from "./source-learning-contract";

type Network = SourceLearningReport["network"];
type LearningRun = Pick<QueryRun, "id" | "createdAt" | "usage" | "sourceLearning" | "paymentMode" | "originalFulfillment" | "asker" | "provenance"> & {
  decisions: Array<Pick<QueryRun["decisions"][number], "sourceId">>;
};
/** Bounded public-store aggregate. Private job stores and legacy query_memories are never read. */
export async function readSourceLearning(db: Pick<KeryxDB, "getSource" | "iterateRecentQueries">,
  sourceId: string, network: Network): Promise<SourceLearningReport | null> {
  sourceLearningId.parse(sourceId);
  if (!await db.getSource(sourceId)) return null;
  const rows: LearningRun[] = [];
  for await (const run of db.iterateRecentQueries(SOURCE_LEARNING_SCAN)) {
    // Release the large answer, trace and question before advancing the storage iterator.
    rows.push({ id: run.id, createdAt: run.createdAt, usage: run.usage, sourceLearning: run.sourceLearning,
      paymentMode: run.paymentMode, originalFulfillment: run.originalFulfillment, asker: run.asker, provenance: run.provenance,
      decisions: run.decisions.filter(d => d.sourceId === sourceId).map(d => ({ sourceId: d.sourceId })) });
    if (rows.length >= SOURCE_LEARNING_SCAN) break;
  }
  return aggregateSourceLearning(sourceId, network, rows);
}

export function aggregateSourceLearning(sourceId: string, network: Network, runs: readonly LearningRun[]): SourceLearningReport {
  sourceLearningId.parse(sourceId);
  const records = new Map<string, { observations: Array<{ row: NonNullable<QueryRun["sourceLearning"]>["sources"][number]; at: string }>; actors: Set<string> }>();
  let excludedObservations = 0, historicalUnclassifiedRuns = 0;
  const runIds = new Map<string, string>();
  for (const run of [...runs].slice(0, SOURCE_LEARNING_SCAN).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))) {
    if (run.id.startsWith("prv_") || run.originalFulfillment) continue;
    const snapshot = parseSourceLearningSnapshot(run.sourceLearning);
    if (!snapshot) {
      if (run.decisions.some(d => d.sourceId === sourceId)) historicalUnclassifiedRuns++;
      continue;
    }
    if (snapshot.network !== network) continue;
    const fingerprint = JSON.stringify([snapshot, parseRunUsage(run.usage), run.createdAt, run.paymentMode, run.asker?.toLowerCase(), parseRunProvenance(run.provenance)]), previous = runIds.get(run.id);
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new Error("Conflicting learning run");
      continue;
    }
    runIds.set(run.id, fingerprint);
    const matching = snapshot.sources.filter(row => row.sourceId === sourceId);
    if (matching.length > 1) throw new Error("Duplicate learning source");
    const row = matching[0];
    if (!row) continue;
    const usage = parseRunUsage(run.usage);
    const provenance = parseRunProvenance(run.provenance);
    if (row.eligibility !== "eligible" || usage?.network !== network || usage.cohort !== "outside"
      || usage.payment !== "independent" || !usage.actorEvidenceSha256 || run.paymentMode !== "real"
      || !provenance || provenance.ownershipMethod === "unknown" || !/^0x[a-fA-F0-9]{40}$/.test(run.asker ?? "")
      || !Number.isFinite(Date.parse(run.createdAt)) || new Date(run.createdAt).toISOString() !== run.createdAt)
      { excludedObservations++; continue; }
    if (row.bought && (!row.read || row.accessMicros === "0") || !row.bought && (row.accessMicros !== "0" || row.cited)
      || !row.cited && row.contribution !== 0 || row.cached && !row.read) throw new Error("Inconsistent learning outcome");
    for (const topic of new Set(row.topics)) {
      const record = records.get(topic) ?? { observations: [], actors: new Set<string>() };
      // An evidence digest can differ between proofs for the same actor; cap the already
      // server-verified wallet, never an editable label or a per-run evidence hash.
      const actorDay = `${run.asker!.toLowerCase()}:${run.createdAt.slice(0, 10)}`;
      if (record.observations.length >= SOURCE_LEARNING_SAMPLE || record.actors.has(actorDay)) continue;
      record.actors.add(actorDay); record.observations.push({ row, at: run.createdAt }); records.set(topic, record);
    }
  }
  const projected = [...records].sort(([a], [b]) => a.localeCompare(b)).slice(0, 12).map(([topic, { observations }]) => {
    const bought = observations.filter(o => o.row.bought), cited = bought.filter(o => o.row.cited).length;
    const rate = (rows: typeof bought) => rows.filter(o => o.row.cited).length / rows.length;
    return { topic, offered: observations.length, read: observations.filter(o => o.row.read).length,
      cached: observations.filter(o => o.row.cached).length, bought: bought.length, cited,
      smoothedCitationRate: bought.length ? (cited + 1) / (bought.length + 2) : null,
      uncertainty: bought.length ? 1 / Math.sqrt(bought.length + 2) : null,
      averageContribution: bought.length ? bought.reduce((sum, o) => sum + o.row.contribution, 0) / bought.length : null,
      averagePriceMicros: { numerator: bought.reduce((sum, o) => sum + BigInt(o.row.accessMicros), BigInt(0)).toString(), denominator: bought.length },
      shiftFlag: bought.length >= 10 && Math.abs(rate(bought.slice(0, 5)) - rate(bought.slice(5, 10))) >= 0.6,
      firstObservedAt: observations.at(-1)?.at ?? null, lastObservedAt: observations[0]?.at ?? null };
  });
  return validateSourceLearningReport({ schemaVersion: "keryx-source-learning-v1", sourceId, network,
    status: "observational-live-selection-withheld", counting: "one-source-topic-run-and-one-attested-actor-per-utc-day",
    settlementEvidence: "recorded-only-not-revalidated", scanLimit: SOURCE_LEARNING_SCAN, sampleLimit: SOURCE_LEARNING_SAMPLE,
    excludedObservations, historicalUnclassifiedRuns, records: projected,
    exploration: { liveFractionBps: 0, liveAllowanceMicros: "0", status: "withheld-pending-policy-and-authority-acceptance" } }, sourceId);
}

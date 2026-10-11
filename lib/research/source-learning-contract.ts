import { z } from "zod";
import { boundedPortableCopy } from "./bounded-portable-json";

export const SOURCE_LEARNING_SCAN = 300;
export const SOURCE_LEARNING_SAMPLE = 60;
export const sourceLearningId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const topic = z.string().regex(/^[a-z0-9]{3,40}$/);
const count = z.number().int().min(0).max(SOURCE_LEARNING_SCAN);
const weight = z.number().finite().min(0).max(1);
const micros = z.string().regex(/^(0|[1-9]\d{0,29})$/);
export const sourceLearningSnapshotSchema = z.object({
  version: z.literal(1), network: z.enum(["eip155:5042", "eip155:5042002"]),
  sources: z.array(z.object({ sourceId: sourceLearningId, topics: z.array(topic).min(1).max(12),
    eligibility: z.enum(["eligible", "owner", "unknown", "non-independent", "synthetic", "authority-unavailable", "offline"]),
    read: z.boolean(), cached: z.boolean(), bought: z.boolean(), cited: z.boolean(),
    accessMicros: micros, contribution: weight }).strict()).max(100),
}).strict().superRefine((snapshot, context) => {
  const sources = new Set<string>();
  for (const row of snapshot.sources) {
    if (sources.has(row.sourceId) || new Set(row.topics).size !== row.topics.length
      || row.bought && (!row.read || row.accessMicros === "0")
      || !row.bought && (row.accessMicros !== "0" || row.cited)
      || !row.cited && row.contribution !== 0 || row.cached && !row.read)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent or duplicate learning observation" });
    sources.add(row.sourceId);
  }
});
export type SourceLearningSnapshot = z.infer<typeof sourceLearningSnapshotSchema>;
export function parseSourceLearningSnapshot(value: unknown): SourceLearningSnapshot | undefined {
  try { return sourceLearningSnapshotSchema.parse(boundedPortableCopy(value, 128 * 1024)); } catch { return; }
}
const record = z.object({ topic, offered: count, read: count, cached: count, bought: count, cited: count,
  smoothedCitationRate: weight.nullable(), uncertainty: weight.nullable(), averageContribution: weight.nullable(),
  averagePriceMicros: z.object({ numerator: micros, denominator: count }).strict(),
  shiftFlag: z.boolean(), firstObservedAt: z.string().datetime().nullable(), lastObservedAt: z.string().datetime().nullable(),
}).strict();
export const sourceLearningReportSchema = z.object({ schemaVersion: z.literal("keryx-source-learning-v1"),
  sourceId: sourceLearningId, network: z.enum(["eip155:5042", "eip155:5042002"]),
  status: z.literal("observational-live-selection-withheld"),
  counting: z.literal("one-source-topic-run-and-one-attested-actor-per-utc-day"),
  settlementEvidence: z.literal("recorded-only-not-revalidated"),
  scanLimit: z.literal(SOURCE_LEARNING_SCAN), sampleLimit: z.literal(SOURCE_LEARNING_SAMPLE),
  excludedObservations: count, historicalUnclassifiedRuns: count, records: z.array(record).max(12),
  exploration: z.object({ liveFractionBps: z.literal(0), liveAllowanceMicros: z.literal("0"),
    status: z.literal("withheld-pending-policy-and-authority-acceptance") }).strict(),
}).strict();
export type SourceLearningReport = z.infer<typeof sourceLearningReportSchema>;
export function validateSourceLearningReport(value: unknown, expectedId?: string): SourceLearningReport {
  const report = sourceLearningReportSchema.parse(boundedPortableCopy(value, 64 * 1024));
  if (expectedId !== undefined && report.sourceId !== sourceLearningId.parse(expectedId)) throw new Error("Source record mismatch");
  const seen = new Set<string>();
  for (const r of report.records) {
    if (seen.has(r.topic) || r.offered > SOURCE_LEARNING_SAMPLE || r.read > r.offered || r.cached > r.read
      || r.bought > r.read || r.cited > r.bought || r.averagePriceMicros.denominator !== r.bought
      || r.smoothedCitationRate !== (r.bought ? (r.cited + 1) / (r.bought + 2) : null)
      || r.uncertainty !== (r.bought ? 1 / Math.sqrt(r.bought + 2) : null)
      || r.bought === 0 && (r.averageContribution !== null || r.averagePriceMicros.numerator !== "0")
      || r.bought > 0 && (r.averageContribution === null || r.averageContribution > r.cited / r.bought + 1e-12 || r.averagePriceMicros.numerator === "0")
      || r.bought < 10 && r.shiftFlag
      || r.offered === 0 && (r.firstObservedAt !== null || r.lastObservedAt !== null)
      || r.offered > 0 && (r.firstObservedAt === null || r.lastObservedAt === null)
      || r.firstObservedAt && r.lastObservedAt && r.firstObservedAt > r.lastObservedAt) throw new Error("Source record bindings refused");
    seen.add(r.topic);
  }
  return report;
}

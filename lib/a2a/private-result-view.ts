import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { privateSpendView } from "./private-spend-view";

const unit = z.number().finite().min(0).max(1);
const index = z.number().int().nonnegative();
const item = { itemId: z.string().optional(), itemTitle: z.string().optional(), contentVersion: z.string().optional() };
// Zod objects strip fields not explicitly selected, including nested receipt/transport data.
const resultSchema = z.object({
  id: z.string(), question: z.string(), budget: unit, researchMode: z.enum(["quick", "deep"]),
  paymentMode: z.literal("real"), fundingOwner: z.literal("treasury"), origin: z.literal("a2a"),
  answer: z.string(), engine: z.string(), createdAt: z.string().datetime({ offset: true }),
  subClaims: z.array(z.string()),
  decisions: z.array(z.object({ sourceId: z.string(), sourceName: z.string(), ...item,
    action: z.enum(["BUY", "SKIP", "CACHE"]), rationale: z.string(), price: z.number().finite().nonnegative(),
    expectedValue: unit, confidence: unit, targets: z.array(index) })),
  citations: z.array(z.object({ marker: z.string(), sourceId: z.string(), sourceName: z.string(), ...item,
    weight: unit, reward: unit, rationale: z.string() })),
  evidence: z.array(z.object({ claimIndex: index, claim: z.string(), marker: z.string(),
    sourceId: z.string(), sourceName: z.string(), ...item, quote: z.string(), support: unit,
    qualifiesForReward: z.boolean() })).optional(),
  claimCoverage: z.array(z.object({ claimIndex: index, claim: z.string(), coverage: unit, coveredBy: z.array(z.string()) })).optional(),
});

type ResultReader = Pick<KeryxDB, "getPrivateResearchIntent" | "getPrivatePaymentState" |
  "listPrivateCreatorSubmissions" | "getPrivateCreatorConfirmation" |
  "getPrivateResearchExecution" | "getPrivateResearchResult">;

/** Owner-only backend read; the HTTP/session boundary must authenticate payer independently. */
export async function privateResultView(db: ResultReader, id: string, payer: string) {
  const intent = await db.getPrivateResearchIntent(id, payer);
  if (!intent) return null;
  const spend = await privateSpendView(db, id, payer);
  if (!spend) throw new Error("Private spend unavailable");
  const request = intent.submission.request;
  const base = { format: "private-result-v1" as const,
    request: { question: request.question, researchMode: request.researchMode, model: request.model,
      packageVersion: request.packageVersion, creatorBudgetMicros: spend.creator.budgetMicros }, spend };
  if (spend.incoming.status !== "settled") return { ...base, status: "awaiting-payment" as const, result: null };
  const claim = await db.getPrivateResearchExecution(id, payer);
  if (!claim) return { ...base, status: "awaiting-execution" as const, result: null };
  const saved = await db.getPrivateResearchResult(id, payer);
  if (!saved) return { ...base, status: "execution-claimed" as const, result: null };
  let run: z.infer<typeof resultSchema>;
  try {
    if (saved.format !== "query-run-v1" || saved.id !== id) throw new Error("Format mismatch");
    run = resultSchema.parse(JSON.parse(saved.serializedRun));
    if (run.id !== id || run.question !== request.question || run.budget !== request.budget || run.researchMode !== request.researchMode
      || run.decisions.some(decision => decision.targets.some(target => target >= run.subClaims.length))
      || [...(run.evidence ?? []), ...(run.claimCoverage ?? [])].some(row => run.subClaims[row.claimIndex] !== row.claim)) throw new Error("Identity mismatch");
  } catch { throw new Error("Private result projection unavailable"); }
  return { ...base, status: "completed" as const, result: {
    answer: run.answer, engine: run.engine, createdAt: run.createdAt, savedAt: saved.savedAt,
    subClaims: run.subClaims, decisions: run.decisions,
    citations: run.citations.map(({ reward, ...citation }) => ({ ...citation, recordedRewardUsdc: reward })),
    evidence: run.evidence ?? null, claimCoverage: run.claimCoverage ?? null,
    paymentEvidence: "see-current-spend" as const,
  } };
}

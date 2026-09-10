import { z } from "zod";

const id = z.string().regex(/^prv_[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const wallet = z.string().regex(/^0x[a-f0-9]{40}$/);
const micros = z.string().regex(/^(0|[1-9]\d{0,7})$/);
const unit = z.number().finite().min(0).max(1);
export const privateWorkspaceCursorSchema = z.object({ id, createdAt: date }).strict();
export const privateWorkspaceHistorySchema = z.object({
  wallet, format: z.literal("private-history-v1"),
  jobs: z.array(z.object({ id, createdAt: date, question: z.string(), researchMode: z.enum(["quick", "deep"]),
    model: z.string().nullable(), packageVersion: z.string(), priceMicros: micros, record: z.literal("private-intent") })).max(25),
  nextCursor: privateWorkspaceCursorSchema.nullable(),
});
export const privateWorkspaceResultSchema = z.object({
  wallet, format: z.literal("private-result-v1"),
  status: z.enum(["awaiting-payment", "awaiting-execution", "execution-claimed", "completed"]),
  request: z.object({ question: z.string(), researchMode: z.enum(["quick", "deep"]), model: z.string().nullable(), packageVersion: z.string(), creatorBudgetMicros: micros }),
  spend: z.object({ format: z.literal("private-spend-v1"), chainFinalityVerified: z.literal(false),
    incoming: z.object({ status: z.enum(["not-submitted", "pending", "settled"]), priceMicros: micros }),
    creator: z.object({ budgetMicros: micros, committedMicros: micros, unresolvedMicros: micros, processingMicros: micros,
      confirmedMicros: micros, uncommittedMicros: micros, payments: z.array(z.object({
        kind: z.enum(["fetch", "citation"]), sourceId: z.string(), payee: wallet, amountMicros: micros,
        status: z.enum(["unresolved", "received", "batched", "confirmed", "completed", "facilitator-confirmed"]),
        evidenceSource: z.enum(["circle-facilitator-success", "circle-transfer-search"]).nullable(), reference: z.string().nullable(),
      })) }),
  }),
  result: z.object({ answer: z.string(), engine: z.string(), savedAt: date, subClaims: z.array(z.string()),
    decisions: z.array(z.object({ sourceName: z.string(), action: z.enum(["BUY", "SKIP", "CACHE"]), rationale: z.string(), price: z.number().finite().nonnegative(), targets: z.array(z.number().int().nonnegative()) })),
    citations: z.array(z.object({ marker: z.string(), sourceName: z.string(), weight: unit, recordedRewardUsdc: unit, rationale: z.string() })),
    evidence: z.array(z.object({ claimIndex: z.number().int().nonnegative(), sourceName: z.string(), quote: z.string(), qualifiesForReward: z.boolean() })).nullable(),
    claimCoverage: z.array(z.object({ claimIndex: z.number().int().nonnegative(), claim: z.string(), coverage: unit })).nullable(),
  }).nullable(),
}).refine(value => (value.status === "completed") === (value.result !== null));
export type PrivateWorkspaceHistory = z.infer<typeof privateWorkspaceHistorySchema>;
export type PrivateWorkspaceResult = z.infer<typeof privateWorkspaceResultSchema>;
export function privateUsdc(value: string) {
  const padded = value.padStart(7, "0");
  return `${padded.slice(0, -6)}.${padded.slice(-6)} USDC`;
}

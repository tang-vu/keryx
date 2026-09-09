import { z } from "zod";
import { a2aQueryIdSchema } from "./buyer-workspace";
import { browserSha256, verifyBrowserReceipt } from "../browser-receipt-integrity";

const receiptDecisionsSchema = z.object({
  payload: z.object({
    schema: z.literal("urn:keryx:research-receipt:1"),
    dispatch: z.object({ id: a2aQueryIdSchema, answer: z.string() }),
    agency: z.object({ decisions: z.array(z.object({
      sourceName: z.string(),
      itemTitle: z.string().optional(),
      action: z.enum(["BUY", "SKIP", "CACHE"]),
      rationale: z.string(),
      priceUsdc: z.number().finite().nonnegative(),
      targets: z.array(z.number().int().nonnegative()),
    })) }),
  }),
});

/** Display only; schema and job matching do not authenticate a portable receipt. */
export function readBuyerDecisions(value: unknown, queryId: string, answer: string) {
  const { payload } = receiptDecisionsSchema.parse(value);
  if (payload.dispatch.id !== queryId || payload.dispatch.answer !== answer) {
    throw new Error("Receipt does not match this job and answer");
  }
  return payload.agency.decisions;
}

export type BuyerDecisions = ReturnType<typeof readBuyerDecisions>;

/** Integrity and displayed-result binding only; no original buyer intent is available here. */
export async function verifyBrowserDecisions(value: unknown, headerDigest: string | null, queryId: string, answer: string) {
  const verified = await verifyBrowserReceipt(value);
  if (!verified.valid || verified.actualDigest !== headerDigest) throw new Error("Receipt integrity or response digest mismatch");
  const decisions = readBuyerDecisions(value, queryId, answer);
  const { payload } = z.object({ payload: z.object({ dispatch: z.object({ answerSha256: z.string() }) }) }).parse(value);
  if (payload.dispatch.answerSha256 !== await browserSha256(answer)) throw new Error("Receipt answer digest mismatch");
  return decisions;
}

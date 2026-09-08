import { z } from "zod";
import { a2aQueryIdSchema } from "./buyer-workspace";

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

import { z } from "zod";
import { a2aQueryIdSchema } from "./buyer-workspace";

export const accountHistorySchema = z.object({
  wallet: z.string().regex(/^0x[a-f0-9]{40}$/),
  jobs: z.array(z.object({
    id: a2aQueryIdSchema, question: z.string().nullable(),
    status: z.enum(["queued", "processing", "review_required", "completed", "failed"]),
    createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
    mode: z.enum(["quick", "deep"]), packagePriceUsdc: z.number().finite().nonnegative().nullable(),
  }).strict()).max(25),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,300}$/).nullable(),
}).strict();
export type AccountHistory = z.infer<typeof accountHistorySchema>;

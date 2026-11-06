import { z } from "zod";

export const privateResearchIdSchema = z.string().regex(/^prv_[a-f0-9]{64}$/)
  .describe("Exact private research ID: prv_ followed by 64 lowercase hex digits; preserve it and keep it private.");
export const privateHistoryCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: privateResearchIdSchema }).strict();

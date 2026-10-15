import { z } from "zod";

export const privateResearchIdSchema = z.string().regex(/^prv_[a-f0-9]{64}$/);
export const privateHistoryCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: privateResearchIdSchema }).strict();

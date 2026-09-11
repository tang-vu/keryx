import { z } from "zod";
import { maxUint256 } from "viem";
import { withdrawalIdSchema, withdrawalOwnerSchema } from "./withdrawal-request";

const time = z.string().max(40).datetime({ offset: true });
const amount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) <= maxUint256);
export const withdrawalHistoryCursorSchema = z.object({ createdAt: time, id: withdrawalIdSchema }).strict();
// Strip unknown storage fields; signatures must never become history response data.
export const withdrawalHistoryEntrySchema = z.object({ id: withdrawalIdSchema, owner: withdrawalOwnerSchema,
  createdAt: time, amountMicros: amount, maxFeeMicros: amount, recipient: withdrawalOwnerSchema });
export const withdrawalHistoryPageSchema = z.object({ requests: z.array(withdrawalHistoryEntrySchema).max(25),
  nextCursor: withdrawalHistoryCursorSchema.nullable() });
export type WithdrawalHistoryCursor = z.infer<typeof withdrawalHistoryCursorSchema>;
export type WithdrawalHistoryEntry = z.infer<typeof withdrawalHistoryEntrySchema>;
export type WithdrawalHistoryPage = z.infer<typeof withdrawalHistoryPageSchema>;

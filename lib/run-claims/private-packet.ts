import { z } from "zod";
import { runClaimDeliverySchema, runClaimIdSchema } from "./contracts";

/** Transport-only, browser-safe contract. Never part of a saved/public run. */
export const privateRunClaimPacketSchema = z.discriminatedUnion("status", [
  z.object({ version: z.literal(1), runId: runClaimIdSchema, status: z.literal("available"), delivery: runClaimDeliverySchema }).strict(),
  z.object({ version: z.literal(1), runId: runClaimIdSchema, status: z.literal("unavailable") }).strict(),
]);
export type PrivateRunClaimPacket = z.infer<typeof privateRunClaimPacketSchema>;

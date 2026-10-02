import { z } from "zod";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase());
/** Public authority captured when the browser initiates revoke, never reread after awaits. */
export const sessionRevokeRequestSchema = z.object({
  sessionId: address,
  grantEpoch: z.string().min(1).max(128),
  sessAddr: address,
}).strict();

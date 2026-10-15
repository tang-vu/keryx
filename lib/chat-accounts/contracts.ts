import { z } from "zod";
import { accountIdSchema, canonicalWalletSchema, digestSchema, snapshotSchema, bindingSchema, timeSchema } from "../accounts/contracts";
import type { AccountSnapshot, AccountBinding } from "../accounts/contracts";

export const CHAT_LINK_TTL_MS = 300_000;
export const chatPlatformSchema = z.enum(["telegram", "slack", "discord"]);
const recipientFields = { platform: chatPlatformSchema, scope: z.string().min(1).max(128),
  userId: z.string().min(1).max(128), channel: z.string().min(1).max(128) };
export const recipientSchema = z.object(recipientFields).strict().superRefine((r, ctx) => {
  const valid = r.platform === "telegram" ? r.scope === "telegram" && /^[1-9]\d{0,15}$/.test(r.userId) && /^-?[1-9]\d{0,15}$/.test(r.channel)
    : r.platform === "slack" ? /^T[A-Z0-9]{1,63}$/.test(r.scope) && /^U[A-Z0-9]{1,63}$/.test(r.userId) && /^[CDG][A-Z0-9]{1,63}$/.test(r.channel)
    : /^[1-9]\d{0,19}$/.test(r.scope) && /^[1-9]\d{0,19}$/.test(r.userId) && /^[1-9]\d{0,19}$/.test(r.channel);
  if (!valid) ctx.addIssue({ code: "custom", message: "invalid_private_recipient" });
});
export type ChatRecipient = z.infer<typeof recipientSchema>;
export const linkSchema = z.object({ ...recipientFields, accountId: accountIdSchema, wallet: canonicalWalletSchema,
  memberGeneration: digestSchema, linkedAt: timeSchema, binding: bindingSchema }).strict().refine(r => recipientSchema.safeParse({
    platform: r.platform, scope: r.scope, userId: r.userId, channel: r.channel }).success);
export type ChatLink = z.infer<typeof linkSchema>;
export const pendingSchema = z.object({ purpose: z.literal("chat-account-link-v1"), tokenHash: digestSchema,
  recipient: recipientSchema, binding: bindingSchema, issuedAt: timeSchema, expiresAt: timeSchema }).strict()
  .refine(p => p.expiresAt === p.issuedAt + CHAT_LINK_TTL_MS
    && (p.recipient.platform !== "telegram" || p.recipient.channel === p.recipient.userId)
    && (p.recipient.platform !== "slack" || p.recipient.channel.startsWith("D")));
export type PendingChatLink = z.infer<typeof pendingSchema>;
export const completionSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/),
  consentProof: z.string().regex(/^[0-9]{1,16}\.[a-f0-9]{64}$/),
  accountId: accountIdSchema, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  consent: z.object({ version: z.literal(1), linkFutureRuns: z.literal(true), financialAuthorityUnchanged: z.literal(true) }).strict(),
  pastRunIds: z.array(z.string()).max(0) }).strict();
export class ChatAccountError extends Error {
  constructor(readonly code: "chat_unavailable" | "chat_token_invalid" | "chat_takeover_refused" | "chat_account_changed"
    | "chat_private_required" | "chat_invalid_command" | "chat_past_runs_unavailable") { super(code); }
}
export interface ChatAccountLinksStore {
  issue(pending: PendingChatLink): Promise<void>;
  preview(tokenHash: string, binding: AccountBinding): Promise<PendingChatLink>;
  complete(tokenHash: string, snapshot: AccountSnapshot): Promise<ChatLink>;
  lookup(recipient: ChatRecipient, binding: AccountBinding): Promise<ChatLink | null>;
  unlink(recipient: ChatRecipient, binding: AccountBinding): Promise<void>;
  list(snapshot: AccountSnapshot): Promise<ChatLink[]>;
  unlinkAccount(recipient: ChatRecipient, snapshot: AccountSnapshot): Promise<void>;
}
export { snapshotSchema };

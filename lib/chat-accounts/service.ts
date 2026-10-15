import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { bindingSchema } from "../accounts/contracts";
import { snapshotSchema, type AccountBinding, type AccountSnapshot } from "../accounts/contracts";
import type { KeryxDB } from "../db/keryx-db";
import { CHAT_LINK_TTL_MS, ChatAccountError, recipientSchema, type ChatRecipient, type ChatAccountLinksStore } from "./contracts";

export function chatTokenHash(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ChatAccountError("chat_token_invalid");
  return createHash("sha256").update(`keryx:chat-account-link:v1:${token}`).digest("hex");
}
// Reuse the existing server-only web-auth secret with a distinct purpose. No
// caller claims or session identifiers leave this boundary; no new credential.
function consentMac(tokenHash: string, raw: AccountSnapshot, expiresAt: number): string {
  const s = snapshotSchema.parse(raw);
  const consentKey = process.env.JWT_SECRET;
  if (!consentKey || Buffer.byteLength(consentKey, "utf8") < 32) throw new ChatAccountError("chat_unavailable");
  return createHmac("sha256", consentKey).update(JSON.stringify([
    "keryx:chat-account-consent:v1", tokenHash, expiresAt,
    s.session.sessionHash, s.session.wallet, s.session.issuedAt, s.session.expiresAt,
    s.memberGeneration, s.credentialGeneration, s.membership.accountId,
    s.membership.revision, s.binding.origin, s.binding.network,
  ])).digest("hex");
}
/** Only issue after native preview and assertCurrent of the request's snapshot. */
export function chatConsentProof(tokenHash: string, snapshot: AccountSnapshot, expiresAt: number): string {
  return `${expiresAt}.${consentMac(tokenHash, snapshot, expiresAt)}`;
}
export function assertChatConsentProof(proof: string, tokenHash: string, snapshot: AccountSnapshot): void {
  const match = /^([0-9]{1,16})\.([a-f0-9]{64})$/.exec(proof), now = Date.now();
  const expiresAt = match ? Number(match[1]) : 0;
  if (!match || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + CHAT_LINK_TTL_MS
    || !timingSafeEqual(Buffer.from(match[2], "hex"), Buffer.from(consentMac(tokenHash, snapshot, expiresAt), "hex")))
    throw new ChatAccountError("chat_account_changed");
}
/** Own non-enumerable optional port only; never a spread/prototype fallback. */
export function chatAccountPort(db: Pick<KeryxDB, "chatAccountLinks">): ChatAccountLinksStore | null {
  const property = Object.getOwnPropertyDescriptor(db, "chatAccountLinks");
  if (!property || property.enumerable || !("value" in property)) return null;
  const value = property.value as ChatAccountLinksStore | undefined;
  return value && ["issue", "preview", "complete", "lookup", "unlink", "list", "unlinkAccount"]
    .every(key => typeof Reflect.get(value, key) === "function") ? value : null;
}
export type ChatControl = "link" | "unlink" | "whoami";
export function exactChatControl(value: string): ChatControl | null {
  const match = /^\/?(link|unlink|whoami)(?:@\w+)?$/u.exec(value.trim());
  return match ? match[1] as ChatControl : null;
}
/** Called ONLY after the route verifies the real provider envelope. No public identity DTO. */
export async function chatControlReply(options: { command: ChatControl; recipient: ChatRecipient;
  binding: AccountBinding; db(): Promise<KeryxDB> }): Promise<string> {
  const recipient = recipientSchema.parse(options.recipient), binding = bindingSchema.parse(options.binding);
  if (recipient.platform === "telegram" && recipient.channel !== recipient.userId
    || recipient.platform === "slack" && !recipient.channel.startsWith("D")) throw new ChatAccountError("chat_private_required");
  const db = await options.db(), port = chatAccountPort(db);
  if (!port) throw new ChatAccountError("chat_unavailable");
  if (options.command === "unlink") {
    await port.unlink(recipient, binding);
    return "Chat account unlinked. Future questions will no longer attach to that account.";
  }
  const current = await port.lookup(recipient, binding);
  if (options.command === "whoami") {
    if (!current) return "This chat account is not linked.";
    // A handle is presentation only, never binding authority; account ID is the honest fallback.
    const profile = await db.privateProfiles?.get(current.wallet, binding.network).catch(() => null);
    return `Linked to ${profile?.profile?.handle ? `@${profile.profile.handle}` : current.accountId}. Financial authority stays separate.`;
  }
  if (current) return "Already linked. Unlink this chat account before linking another account.";
  const token = randomBytes(32).toString("hex"), issuedAt = Date.now();
  await port.issue({ purpose: "chat-account-link-v1", tokenHash: chatTokenHash(token), recipient, binding,
    issuedAt, expiresAt: issuedAt + CHAT_LINK_TTL_MS });
  const url = new URL("/me/chat-accounts", binding.origin);
  url.hash = `token=${token}`;
  return `Sign in and explicitly confirm this chat link within five minutes: ${url.href}\nKeep this link private. It grants history ownership only, with no payment or custody authority.`;
}

/** Binding lookup precedes research. Linked ownership never supplies funding/payer authority. */
export async function linkedChatOwner(db: KeryxDB, recipient: ChatRecipient, binding: AccountBinding): Promise<string | undefined> {
  const port = chatAccountPort(db);
  if (!port) return undefined;
  return (await port.lookup(recipientSchema.parse(recipient), bindingSchema.parse(binding)))?.wallet;
}

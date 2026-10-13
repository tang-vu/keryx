import { createHash } from "node:crypto";
import type { KeryxDB } from "../db/keryx-db";
import { presentationLanguage, type PresentationLanguage } from "../research/presentation-language";

/** Source email configuration supplied by the existing owner-authorized settings.
 * No account/wallet join and no language inferred from a reader's question. */
export interface EmailRecipient { sourceId: string; email: string; unsubToken: string }
type Store = Partial<Pick<KeryxDB, "getSyncState" | "setSyncState">>;

export function recipientLanguageKey(recipient: EmailRecipient): string | undefined {
  if (!recipient.sourceId || recipient.sourceId.length > 256 || recipient.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email) || !/^[a-f0-9]{64}$/u.test(recipient.unsubToken)) return undefined;
  // Token rotation/replacement starts a fresh preference; never transfer it to a new recipient.
  return "keryx:email-language:v1:" + createHash("sha256")
    .update(JSON.stringify([recipient.sourceId, recipient.email, recipient.unsubToken])).digest("hex");
}

export async function readRecipientLanguage(db: Store, recipient: EmailRecipient): Promise<{ language: PresentationLanguage; available: boolean }> {
  const key = recipientLanguageKey(recipient);
  if (!key || !db.getSyncState) return { language: "en", available: false };
  try {
    const value = await db.getSyncState(key);
    const language = presentationLanguage(value);
    return { language: language ?? "en", available: value === null || language !== undefined };
  } catch { return { language: "en", available: false }; }
}

export async function writeRecipientLanguage(db: Store, recipient: EmailRecipient, value: unknown): Promise<boolean> {
  const key = recipientLanguageKey(recipient), language = presentationLanguage(value);
  if (!key || !language || !db.getSyncState || !db.setSyncState) return false;
  try {
    await db.setSyncState(key, language);
    return await db.getSyncState(key) === language;
  } catch { return false; }
}

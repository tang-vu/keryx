import { getDb } from "../db";
import type { KeryxDB } from "../db/keryx-db";
import { answerPresentation } from "../research/answer-presentation";
import { botPreferenceKey, botLanguage, type BotLanguagePreference, type BotRecipient } from "./language";

type Store = () => Promise<Partial<Pick<KeryxDB, "getSyncState" | "setSyncState">>>;
export function botAnswerPreferenceKey(recipient: BotRecipient | undefined): string | null {
  const key = botPreferenceKey(recipient);
  return key?.replace("keryx:bot-help-language:v1:", "keryx:bot-answer-language:v1:") ?? null;
}
const preference = (value: unknown): BotLanguagePreference | undefined => value === "auto" ? "auto" : botLanguage(value);

/** The old help-only namespace is deliberately not migrated into answer intent. */
export async function readBotAnswerPreference(recipient: BotRecipient | undefined, store: Store = getDb) {
  const key = botAnswerPreferenceKey(recipient);
  if (!key) return { available: false, preference: "auto" as BotLanguagePreference };
  try {
    const db = await store();
    if (!db.getSyncState) return { available: false, preference: "auto" as BotLanguagePreference };
    const value = await db.getSyncState(key), saved = value === null ? "auto" : preference(value);
    return { available: saved !== undefined, preference: saved ?? "auto" };
  } catch { return { available: false, preference: "auto" as BotLanguagePreference }; }
}
export async function writeBotAnswerPreference(recipient: BotRecipient | undefined, value: unknown, store: Store = getDb) {
  const key = botAnswerPreferenceKey(recipient), next = preference(value);
  if (!key || !next) return false;
  try {
    const db = await store();
    if (!db.getSyncState || !db.setSyncState) return false;
    await db.setSyncState(key, next);
    return await db.getSyncState(key) === next;
  } catch { return false; }
}
/** Structured generation preference, never a hidden appended instruction or proof
 * of actual output. The original question's explicit output language takes priority. */
export async function botAnswerPresentation(originalQuestion: string, recipient: BotRecipient | undefined, store: Store = getDb) {
  const original = answerPresentation(originalQuestion), saved = await readBotAnswerPreference(recipient, store);
  const language = original.requestedLanguage ?? (saved.available ? botLanguage(saved.preference) : undefined) ?? original.language;
  return { language, input: { presentationLanguage: language } };
}

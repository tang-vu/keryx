import { createHash } from "node:crypto";
import { getDb } from "../db";
import type { KeryxDB } from "../db/keryx-db";
import { answerPresentation } from "../research/answer-presentation";
import { botControlsEnglish } from "../../locales/en/bot-controls";
import { botControlsVietnamese } from "../../locales/vi/bot-controls";
import { botControlsPortuguese } from "../../locales/pt-BR/bot-controls";
import { botControlsSpanish } from "../../locales/es/bot-controls";
import { botControlsFrench } from "../../locales/fr/bot-controls";
import { botControlsChinese } from "../../locales/zh-Hans/bot-controls";
import { systemPresentationLanguage } from "../../shared/i18n/presentation-language";
import { readBotAnswerPreference, writeBotAnswerPreference } from "./answer-preference";

export type BotLanguage = "en" | "vi" | "pt" | "es" | "fr" | "zh-Hans";
export type BotLanguagePreference = BotLanguage | "auto";
export const botControlsCatalogues = Object.freeze({ en: botControlsEnglish, vi: botControlsVietnamese,
  pt: botControlsPortuguese, es: botControlsSpanish, fr: botControlsFrench, "zh-Hans": botControlsChinese });

/** Finite shipped bot catalogue; unrelated UI locales do not grant bot support. */
export function botLanguage(value: unknown): BotLanguage | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.toLowerCase()) {
    case "en": return "en";
    case "vi": return "vi";
    case "pt": case "pt-br": return "pt";
    case "es": return "es";
    case "fr": return "fr";
    case "zh-hans": return "zh-Hans";
    default: return undefined;
  }
}
function platformLanguage(value: unknown) {
  return systemPresentationLanguage(value);
}
export function botHelpLanguage(input: { explicit?: unknown; stored?: BotLanguagePreference; platformLocale?: unknown } = {}) {
  const explicit = botLanguage(input.explicit), stored = botLanguage(input.stored), platform = platformLanguage(input.platformLocale);
  return explicit ? { language: explicit, source: "explicit" as const }
    : stored ? { language: stored, source: "stored" as const }
    : platform ? { language: platform, source: "platform" as const }
    : { language: "en" as const, source: "default" as const };
}
/** Private placeholder follows the same original-question authority as the answer, never help preferences. */
export function botPrivatePreparing(originalQuestion: string, requestedLanguage?: BotLanguage) {
  return botControlsCatalogues[requestedLanguage ?? answerPresentation(originalQuestion, "ordinary").language].privatePreparing;
}

/** Construct only AFTER transport authentication. These IDs identify a bot recipient,
 * not a wallet/account owner, payer or run-claim holder. Never include channel IDs/tokens. */
export interface BotRecipient { platform: "telegram" | "discord" | "slack"; scope: string; userId: string }
export function botPreferenceKey(recipient: BotRecipient | undefined): string | null {
  if (!recipient) return null;
  const { platform, scope, userId } = recipient;
  const valid = platform === "telegram" ? scope === "telegram" && /^[1-9]\d{0,15}$/u.test(userId) && Number.isSafeInteger(Number(userId))
    : platform === "discord" ? /^[1-9]\d{0,19}$/u.test(scope) && /^[1-9]\d{0,19}$/u.test(userId)
    : platform === "slack" && /^T[A-Z0-9]{1,39}$/u.test(scope) && /^[UW][A-Z0-9]{1,39}$/u.test(userId);
  if (!valid) return null;
  return "keryx:bot-help-language:v1:" + createHash("sha256").update(JSON.stringify([platform, scope, userId])).digest("hex");
}
type PreferenceStore = Partial<Pick<KeryxDB, "getSyncState" | "setSyncState">>;
type Store = () => Promise<PreferenceStore>;
function preference(value: unknown): BotLanguagePreference | undefined {
  return value === "auto" ? "auto" : botLanguage(value);
}
export async function readBotHelpPreference(recipient: BotRecipient | undefined, store: Store = getDb) {
  const key = botPreferenceKey(recipient);
  if (!key) return { available: false, preference: "auto" as BotLanguagePreference };
  try {
    const db = await store();
    if (!db.getSyncState) return { available: false, preference: "auto" as BotLanguagePreference };
    const value = await db.getSyncState(key), saved = value === null ? "auto" : preference(value);
    return { available: saved !== undefined, preference: saved ?? "auto" };
  } catch { return { available: false, preference: "auto" as BotLanguagePreference }; }
}
export async function writeBotHelpPreference(recipient: BotRecipient | undefined, value: unknown, store: Store = getDb) {
  const key = botPreferenceKey(recipient), next = preference(value);
  if (!key || !next) return false;
  try {
    const db = await store();
    if (!db.getSyncState || !db.setSyncState) return false;
    await db.setSyncState(key, next);
    // Some backends can refuse a write without throwing. Never claim a save without readback.
    return await db.getSyncState(key) === next;
  } catch { return false; } // No raw backend diagnostics/recipient identifiers in replies or logs.
}

export interface BotControl { action: "help" | "language"; value?: string }
/** Only reserved English slash commands (or bare help), never question-language guessing. */
export function parseBotControl(text: string): BotControl | null {
  const match = text.trim().match(/^\/(start|help|language|ask)(?:@\w+)?(?:\s+([\s\S]*))?$/u);
  if (!match) return text.trim() === "help" ? { action: "help" } : null;
  if (match[1] === "ask" && match[2]) return null;
  return { action: match[1] === "language" ? "language" : "help", ...(match[2] ? { value: match[2].trim() } : {}) };
}

/** Help is request-local; only an explicit /language value can mutate the private preference. */
export async function botControlResponse(input: { control: BotControl; recipient?: BotRecipient; platformLocale?: unknown;
  privateOnly?: boolean }, store: Store = getDb) {
  const saved = input.privateOnly ? { available: false, preference: "auto" as BotLanguagePreference }
    : input.control.action === "help" ? await readBotHelpPreference(input.recipient, store) : await readBotAnswerPreference(input.recipient, store);
  const language = botHelpLanguage({ explicit: input.control.action === "help" ? input.control.value : undefined,
    stored: saved.preference, platformLocale: input.platformLocale }).language;
  const copy = botControlsCatalogues[language];
  if (input.control.action === "help") return { language, text: "" };
  if (input.privateOnly) return { language, text: copy.languagePrivate };
  const value = input.control.value;
  if (value === undefined) return { language, text: saved.available
    ? copy.languageCurrent.replace("{preference}", saved.preference) + "\n" + copy.languageHelp
    : copy.languageUnavailable + "\n" + copy.languageHelp };
  const next = preference(value);
  if (!next) return { language, text: copy.languageInvalid + "\n" + copy.languageHelp };
  const confirmed = await writeBotAnswerPreference(input.recipient, next, store) && await writeBotHelpPreference(input.recipient, next, store);
  const responseLanguage = confirmed ? botHelpLanguage({ stored: next, platformLocale: input.platformLocale }).language : language;
  const responseCopy = botControlsCatalogues[responseLanguage];
  return { language: responseLanguage, text: confirmed
    ? responseCopy.languageSaved.replace("{preference}", next) + "\n" + responseCopy.languageHelp
    : responseCopy.languageUnavailable + "\n" + responseCopy.languageHelp };
}

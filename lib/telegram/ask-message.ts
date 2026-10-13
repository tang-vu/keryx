/**
 * Telegram /ask message ↔ Keryx mappers (pure, side-effect free).
 *
 * Telegram's Bot API needs no review queue: any user can DM the bot or add it to a group, type
 * /ask, and Keryx runs its full paid-source reasoning loop — the reply lists every creator paid.
 * The route (app/api/telegram/webhook) owns secret verification, rate-limits, and the agent run;
 * this module only translates shapes so both stay small and the translation stays unit-testable —
 * the same split as lib/discord.
 */

import { config } from "../config";
import { unsupportedDecisionReviewFlag } from "../research/decision-review-types";
import { formatRecordedUsdc, formatNumber, selectPlural } from "../i18n/format";
import { answerPresentation } from "../research/answer-presentation";
import { botResearchFailure, botResearchMessages } from "../bots/research-messages";
import { botHelpEnglish } from "../../locales/en/bot-research";
import { botControlsCatalogues, type BotLanguage } from "../bots/language";
import type { QueryRun } from "../types";

/** Telegram caps any message text at 4096 chars; leave room for the citations block + link. */
const ANSWER_MAX = 3000;
const MESSAGE_MAX = 4096;

/** The slice of a Telegram update the /ask flow reads. */
export interface TelegramUpdate {
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number; is_bot?: boolean; language_code?: string };
  };
}

export interface AskMessage {
  question: string;
  chatId: number;
  userId: number;
  messageId?: number;
  chatType?: string;
}

/** Exact reserved account verbs only; arguments never turn controls into research.
 * This recognizes intent, not account ownership. /ask questions remain research. */
export function isTelegramAccountControl(update: TelegramUpdate): boolean {
  const text = update?.message?.text;
  return typeof text === "string" && /^\/?(?:link|unlink|whoami)(?:@\w+)?(?:\s|$)/u.test(text.trim());
}

export const telegramAccountLinkingUnavailable =
  "Telegram account linking is unavailable. This command did not read or change an account binding.";

/**
 * Extract a question from an update, or null when there isn't one. `/ask <q>` (with optional
 * @BotName suffix, as groups append it) works everywhere; in a private chat plain text other than
 * reserved account controls is treated as the question. Other slash commands return null and are
 * handled (or ignored) by the route.
 */
export function parseAskMessage(update: TelegramUpdate): AskMessage | null {
  if (isTelegramAccountControl(update)) return null;
  const msg = update?.message;
  const text = typeof msg?.text === "string" ? msg.text.trim() : "";
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  if (!text || typeof chatId !== "number" || typeof userId !== "number") return null;
  if (msg?.from?.is_bot) return null; // never answer other bots — loop hazard

  let question = "";
  const askMatch = text.match(/^\/ask(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (askMatch) {
    question = (askMatch[1] ?? "").trim();
  } else if (!text.startsWith("/") && msg?.chat?.type === "private") {
    question = text;
  }
  if (!question || unsupportedDecisionReviewFlag(question)) return null;

  return { question, chatId, userId, messageId: msg?.message_id, chatType: msg?.chat?.type };
}

/** True for /start and /help — the two commands that should get the usage text. */
export function isHelpCommand(update: TelegramUpdate): boolean {
  const text = update.message?.text?.trim() ?? "";
  return /^\/(start|help)(@\w+)?$/.test(text);
}

export function helpText(language: BotLanguage = "en", privateChat = true): string {
  const copy = botControlsCatalogues[language];
  return [
    `<b>${botHelpEnglish.herald}</b>${language === "en" ? ` — ${botHelpEnglish.tagline}` : ""}`,
    "",
    ...(language === "en" ? [] : [copy.introduction, copy.financialDetails]),
    botHelpEnglish.telegramExplanation,
    "",
    `${copy.usage} <code>/ask ${copy.exampleQuestion}</code>`,
    copy.reviewBoundary,
    ...(privateChat ? [copy.privateQuestion] : []),
    copy.languageHelp,
    "",
    `${language === "en" ? botHelpEnglish.telegramStatus : copy.status} ${config.baseUrl}/status`,
  ].join("\n");
}

/** Base URL for a Bot API method call. The token lives in the path, so never log these URLs. */
export function apiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

/**
 * The finished answer as one HTML-mode message: bold question, grounded answer, the creators
 * actually paid, and a link to the full dispatch trace (which carries any truncated text).
 */
export function buildAnswerText(run: QueryRun): string {
  const message = botResearchMessages(run.question);
  const locale = answerPresentation(run.question, "ordinary").language;
  const parts = [`<b>${escapeHtml(truncate(run.question, 256))}</b>`, ""];
  parts.push(escapeHtml(truncate(run.answer, ANSWER_MAX)), "");

  if (run.citations.length > 0) {
    parts.push(`<b>${message("citationHeading")}</b>`);
    for (const c of run.citations) {
      parts.push(
        escapeHtml(`${c.sourceName} — ${formatRecordedUsdc(c.reward, { minimumFractionDigits: 4 }, locale)} (${message("weight", { weight: formatNumber(c.weight, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, locale) })})`),
      );
    }
    parts.push("");
  }

  parts.push(
    `${message(run.citations.length > 0 && selectPlural(run.citations.length, locale) === "one" ? "sourcesOne" : "sourcesOther", { count: run.citations.length })} · ${message("recordedCreators", { amount: formatRecordedUsdc(run.totalToCreators, { minimumFractionDigits: 4 }, locale) })} / ${run.paymentMode ?? "legacy"}`,
    message("settlementNotice"),
    message("fullTrace", { url: `${config.baseUrl}/dispatch/${run.id}` }),
  );
  return truncate(parts.join("\n"), MESSAGE_MAX);
}

/** Failure text for the placeholder — the run died, say so instead of hanging forever. */
export function buildErrorText(err: unknown, originalQuestion = ""): string {
  return truncate(escapeHtml(botResearchFailure(err, originalQuestion)), MESSAGE_MAX);
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

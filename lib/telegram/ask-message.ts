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
    from?: { id?: number; is_bot?: boolean };
  };
}

export interface AskMessage {
  question: string;
  chatId: number;
  userId: number;
  messageId?: number;
}

/**
 * Extract a question from an update, or null when there isn't one. `/ask <q>` (with optional
 * @BotName suffix, as groups append it) works everywhere; in a private chat any plain text is
 * treated as the question, so DMing the bot just works. Other slash commands return null and are
 * handled (or ignored) by the route.
 */
export function parseAskMessage(update: TelegramUpdate): AskMessage | null {
  const msg = update.message;
  const text = msg?.text?.trim() ?? "";
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
  if (!question) return null;

  return { question, chatId, userId, messageId: msg?.message_id };
}

/** True for /start and /help — the two commands that should get the usage text. */
export function isHelpCommand(update: TelegramUpdate): boolean {
  const text = update.message?.text?.trim() ?? "";
  return /^\/(start|help)(@\w+)?$/.test(text);
}

export function helpText(): string {
  return [
    "<b>Keryx</b> — the citation-toll research herald.",
    "",
    "Ask a question and Keryx buys the right paid sources, answers with citations, and pays " +
      "every cited creator in USDC on Arc — really, on-chain.",
    "",
    "Usage: <code>/ask what is x402?</code>",
    "In this private chat you can also just type the question.",
    "",
    `Creators keep 100%. Live traction: ${config.baseUrl}/status`,
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
  const parts = [`<b>${escapeHtml(truncate(run.question, 256))}</b>`, ""];
  parts.push(escapeHtml(truncate(run.answer, ANSWER_MAX)), "");

  if (run.citations.length > 0) {
    parts.push("<b>Creators paid — weighted USDC citation rewards on Arc testnet</b>");
    for (const c of run.citations) {
      parts.push(
        escapeHtml(`${c.sourceName} — $${c.reward.toFixed(4)} (weight ${c.weight.toFixed(2)})`),
      );
    }
    parts.push("");
  }

  const plural = run.citations.length === 1 ? "" : "s";
  parts.push(
    `${run.citations.length} creator${plural} paid · $${run.totalToCreators.toFixed(4)} to creators`,
    `Full trace: ${config.baseUrl}/dispatch/${run.id}`,
  );
  return truncate(parts.join("\n"), MESSAGE_MAX);
}

/** Failure text for the placeholder — the run died, say so instead of hanging forever. */
export function buildErrorText(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return truncate(`⚠️ Keryx could not finish this dispatch: ${escapeHtml(detail)}`, MESSAGE_MAX);
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

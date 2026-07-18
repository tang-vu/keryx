/**
 * Telegram webhook endpoint — /ask from any Telegram chat.
 *
 * Point the bot's webhook here (npm run register-telegram); anyone can then DM the bot or add it
 * to a group and ask Keryx in-chat. Keryx runs its full reasoning loop over paid sources and the
 * reply lists every creator paid, with a link to the dispatch trace.
 *
 * Telegram retries any update that doesn't get a quick 200, so the route always acks immediately
 * and finishes the run in `after()` (the VPS Node process keeps running post-response): it posts
 * a placeholder message, runs the agent, then edits the placeholder into the answer — the same
 * deferred-then-edit shape as the Discord front door, over Telegram's Bot API.
 *
 * Auth: Telegram echoes the secret registered with setWebhook on every update in the
 * X-Telegram-Bot-Api-Secret-Token header; anything else is rejected. Payment model: identical to
 * the site's anonymous free trial — treasury-funded, budget clamped to anonMaxBudget, rate-limited
 * per Telegram user id, tagged `web` (a Telegram member is a genuine external human asker).
 * Creators are still really paid on-chain.
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest, after } from "next/server";
import { collectRun } from "@/lib/agent";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  type AskMessage,
  type TelegramUpdate,
  parseAskMessage,
  isHelpCommand,
  helpText,
  apiUrl,
  buildAnswerText,
  buildErrorText,
} from "@/lib/telegram/ask-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!config.telegramBotToken || !config.telegramWebhookSecret) {
    return Response.json({ error: "telegram webhook not configured" }, { status: 503 });
  }

  const presented = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secretMatches(presented, config.telegramWebhookSecret)) {
    return Response.json({ error: "invalid webhook secret" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: "malformed update body" }, { status: 400 });
  }

  // Whatever happens below, Telegram must get a 200 — anything else makes it re-deliver the same
  // update in a retry loop. Replies ride the webhook response itself where possible (one fewer
  // round trip): a JSON body naming a Bot API `method` is executed by Telegram on receipt.
  const chatId = update.message?.chat?.id;
  if (isHelpCommand(update) && typeof chatId === "number") {
    return Response.json({
      method: "sendMessage",
      chat_id: chatId,
      text: helpText(),
      parse_mode: "HTML",
    });
  }

  const cmd = parseAskMessage(update);
  if (!cmd) return Response.json({ ok: true }); // not an /ask — acknowledge and move on
  if (!config.sellerAddress) {
    return Response.json({
      method: "sendMessage",
      chat_id: cmd.chatId,
      text: "Keryx's treasury wallet is not configured on this deployment.",
    });
  }

  // Treasury-funded like the site's free trial — throttle per Telegram user, not per IP
  // (every request arrives from Telegram's servers, so IPs are useless as a key here).
  const limited = await checkRateLimit(`telegram:${cmd.userId}`, "treasuryAsk");
  if (limited) {
    return Response.json({
      method: "sendMessage",
      chat_id: cmd.chatId,
      text: "Free dispatches are rate-limited — try again in a minute.",
    });
  }

  const budget = Math.min(config.defaultBudget, config.anonMaxBudget);
  after(() => runAndReply(cmd, budget));
  return Response.json({ ok: true });
}

/** Constant-time comparison so the webhook secret can't be probed byte by byte. */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Posts a placeholder, runs the agent, then edits the placeholder into the answer. */
async function runAndReply(cmd: AskMessage, budget: number) {
  const placeholderId = await callTelegram<{ message_id?: number }>("sendMessage", {
    chat_id: cmd.chatId,
    text: "⏳ Keryx is dispatching — buying sources and settling citations…",
    reply_to_message_id: cmd.messageId,
    allow_sending_without_reply: true,
  }).then((r) => r?.message_id);

  let text: string;
  try {
    const run = await collectRun({
      question: cmd.question,
      budget,
      queryId: crypto.randomUUID(),
      origin: "web",
    });
    text = buildAnswerText(run);
  } catch (err) {
    console.error("[telegram] /ask run failed:", err);
    text = buildErrorText(err);
  }

  if (typeof placeholderId === "number") {
    const edited = await callTelegram("editMessageText", {
      chat_id: cmd.chatId,
      message_id: placeholderId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    if (edited !== null) return;
  }
  // Placeholder never landed (or the edit failed) — send the answer as a fresh message instead.
  await callTelegram("sendMessage", {
    chat_id: cmd.chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/** One Bot API call; returns the `result` payload, or null on any failure (already logged). */
async function callTelegram<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(config.telegramBotToken, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !data.ok) {
      console.error(`[telegram] ${method} failed: ${res.status} ${data.description ?? ""}`);
      return null;
    }
    return data.result ?? null;
  } catch (err) {
    console.error(`[telegram] ${method} failed:`, err);
    return null;
  }
}

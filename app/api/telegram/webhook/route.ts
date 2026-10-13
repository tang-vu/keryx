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
import { hostedRunClaimsEnabled, prepareHostedRunClaim } from "@/lib/run-claims/hosted-delivery";
import { privateRunClaimText, type PrivateRunClaimPacket } from "@/lib/run-claims/delivery";
import { prepareTelegramPrivateReply, type TelegramPrivatePlaceholder } from "@/lib/run-claims/telegram-private";
import { config } from "@/lib/config";
import { botResearchMessages } from "@/lib/bots/research-messages";
import { botControlResponse, parseBotControl } from "@/lib/bots/language";
import { botAnswerPresentation } from "@/lib/bots/answer-preference";
import { checkSponsoredResearchAdmission } from "@/lib/sponsored-admission";
import {
  type AskMessage,
  type TelegramUpdate,
  parseAskMessage,
  isTelegramAccountControl,
  telegramAccountLinkingUnavailable,
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
    if (!update || typeof update !== "object" || Array.isArray(update)
      || update.message !== undefined && (!update.message || typeof update.message !== "object" || Array.isArray(update.message)
        || update.message.text !== undefined && typeof update.message.text !== "string")) {
      return Response.json({ error: "malformed update body" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "malformed update body" }, { status: 400 });
  }

  // Whatever happens below, Telegram must get a 200 — anything else makes it re-deliver the same
  // update in a retry loop. Replies ride the webhook response itself where possible (one fewer
  // round trip): a JSON body naming a Bot API `method` is executed by Telegram on receipt.
  const chatId = update.message?.chat?.id;
  const sender = update.message?.from;
  const userId = sender?.id;
  // Transport authentication is complete. Never pass account arguments to language/storage,
  // sponsored admission or research, and never include them in a private or group reply.
  if (isTelegramAccountControl(update)) {
    if (typeof chatId !== "number" || !Number.isSafeInteger(chatId)
      || typeof userId !== "number" || !Number.isSafeInteger(userId) || userId <= 0 || sender?.is_bot) {
      return Response.json({ ok: true });
    }
    const privateChat = update.message?.chat?.type === "private" && chatId === userId;
    return Response.json({ method: "sendMessage", chat_id: chatId, text: telegramAccountLinkingUnavailable,
      ...(privateChat ? { protect_content: true } : {}) });
  }
  const control = parseBotControl(update.message?.text ?? "");
  if (control && typeof chatId === "number" && typeof userId === "number" && Number.isSafeInteger(chatId)
    && Number.isSafeInteger(userId) && userId > 0 && !sender?.is_bot) {
    const privateChat = update.message?.chat?.type === "private" && chatId === userId;
    const reply = await botControlResponse({ control, platformLocale: sender?.language_code, privateOnly: !privateChat,
      ...(privateChat ? { recipient: { platform: "telegram", scope: "telegram", userId: String(userId) } } : {}) });
    return Response.json({
      method: "sendMessage",
      chat_id: chatId,
      text: control.action === "help" ? helpText(reply.language, privateChat) : reply.text,
      parse_mode: "HTML",
      ...(privateChat ? { protect_content: true } : {}),
    });
  }

  const cmd = parseAskMessage(update);
  if (!cmd) return Response.json({ ok: true }); // not an /ask — acknowledge and move on
  if (!config.sellerAddress) {
    return Response.json({
      method: "sendMessage",
      chat_id: cmd.chatId,
      text: botResearchMessages(cmd.question, cmd.presentationLanguage)("treasuryUnavailable"),
    });
  }

  // Treasury-funded like the site's free trial — throttle per Telegram user, not per IP
  // (every request arrives from Telegram's servers, so IPs are useless as a key here).
  const limited = await checkSponsoredResearchAdmission({ kind: "bot", platform: "telegram", userId: String(cmd.userId) });
  if (limited) {
    return Response.json({
      method: "sendMessage",
      chat_id: cmd.chatId,
      text: botResearchMessages(cmd.question, cmd.presentationLanguage)("sponsoredLimited"),
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
  const queryId = crypto.randomUUID();
  let privateClaim;
  try { privateClaim = await prepareHostedRunClaim(queryId); }
  catch { return; } // Gated ordinary admission must fail before research/providers.
  const privateReply = hostedRunClaimsEnabled()
    ? await prepareTelegramPrivateReply(cmd, body => callTelegram<TelegramPrivatePlaceholder>("sendMessage", body)) : null;
  if (hostedRunClaimsEnabled() && !privateReply) return;
  // Preference storage never delays admission or bypasses the private reply gates.
  cmd.presentationLanguage = (await botAnswerPresentation(cmd.question, { platform: "telegram", scope: "telegram", userId: String(cmd.userId) })).language;
  const replyChatId = privateReply?.chatId ?? cmd.chatId;
  const placeholderId = privateReply?.placeholderId ?? await callTelegram<{ message_id?: number }>("sendMessage", {
    chat_id: cmd.chatId,
    text: botResearchMessages(cmd.question, cmd.presentationLanguage)("dispatching"),
    reply_to_message_id: cmd.messageId,
    allow_sending_without_reply: true,
  }).then((r) => r?.message_id);

  let text: string, packet: PrivateRunClaimPacket | null | undefined;
  try {
    const run = await collectRun({
      question: cmd.question,
      ...(cmd.presentationLanguage ? { presentationLanguage: cmd.presentationLanguage } : {}),
      budget,
      queryId,
      origin: "web",
      provenance: { version: 1, surface: "telegram", ownershipMethod: "unknown" },
    });
    packet = await privateClaim?.complete(run);
    text = buildAnswerText(run, cmd.presentationLanguage);
  } catch (err) {
    console.error("[telegram] /ask run failed:", err);
    text = buildErrorText(err, cmd.question, cmd.presentationLanguage);
  }

  let edited: unknown = null;
  if (typeof placeholderId === "number") {
    edited = await callTelegram("editMessageText", {
      chat_id: replyChatId,
      message_id: placeholderId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  }
  // Placeholder never landed (or the edit failed) — send the answer as a fresh message instead.
  if (edited === null) await callTelegram("sendMessage", {
    chat_id: replyChatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(privateReply ? { protect_content: true } : {}),
  });
  // The answer builder already uses Telegram's full 4096-character allowance.
  // Keep this credential separate, plain-text and sender-private; never truncate
  // it into an answer or fall back to the original group on delivery failure.
  if (packet && privateReply) await callTelegram("sendMessage", {
    chat_id: privateReply.chatId, text: privateRunClaimText(packet), protect_content: true,
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
      console.error(`[telegram] ${method} failed: ${res.status}`);
      return null;
    }
    return data.result ?? null;
  } catch (err) {
    console.error(`[telegram] ${method} failed`, err instanceof Error ? err.name : "DeliveryError");
    return null;
  }
}

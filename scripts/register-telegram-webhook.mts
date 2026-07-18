/**
 * register-telegram-webhook.mts — point the Telegram bot at Keryx and register its commands.
 *
 * Calls setWebhook (with the shared secret Telegram will echo on every update), setMyCommands
 * (/ask + /help), and setMyDescription so the bot's empty-chat screen explains itself. Safe to
 * re-run: every call is an upsert. Pass --delete to unhook the webhook instead (local testing).
 *
 * Run:  npm run register-telegram
 * Env:  TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET (see docs/telegram-bot-setup.md);
 *       BASE_URL decides where the webhook points (must be public HTTPS — Telegram calls it).
 */

import { config } from "../lib/config.ts";

if (!config.telegramBotToken || !config.telegramWebhookSecret) {
  console.error(
    "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required (see docs/telegram-bot-setup.md).",
  );
  process.exit(1);
}

async function call(method: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; description?: string; result?: unknown };
  if (!res.ok || !data.ok) {
    console.error(`Telegram rejected ${method}: ${res.status} ${data.description ?? ""}`);
    process.exit(1);
  }
  return data.result;
}

if (process.argv.includes("--delete")) {
  await call("deleteWebhook", { drop_pending_updates: true });
  console.log("Webhook deleted.");
  process.exit(0);
}

const webhookUrl = `${config.baseUrl}/api/telegram/webhook`;
await call("setWebhook", {
  url: webhookUrl,
  secret_token: config.telegramWebhookSecret,
  allowed_updates: ["message"], // only chat messages — no edits, joins, or callback noise
  drop_pending_updates: true,
});
console.log(`Webhook set: ${webhookUrl}`);

await call("setMyCommands", {
  commands: [
    { command: "ask", description: "Ask Keryx — it buys paid sources and pays every cited creator" },
    { command: "help", description: "What Keryx is and how to use it" },
  ],
});
console.log("Commands registered: /ask, /help");

await call("setMyDescription", {
  description:
    "Keryx answers your question from paid sources and pays every cited creator in USDC on Arc " +
    "— real on-chain settlement, 100% to creators. Type /ask or just send a question.",
});
await call("setMyShortDescription", {
  short_description: "Research herald that pays every cited creator in USDC on Arc.",
});
console.log("Bot descriptions set.");

const me = (await call("getMe")) as { username?: string };
console.log(`Done. The bot is live as @${me.username ?? "?"} — DM it or add it to a group.`);

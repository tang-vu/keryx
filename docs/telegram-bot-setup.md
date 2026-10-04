# Telegram Bot Setup — `/ask` in any chat

> **The production bot is live.** DM [@keryxai_bot](https://t.me/keryxai_bot) any question, or add
> it to a group and type `/ask …`. The steps below are only needed to stand up your *own* bot
> (fork / self-host).

Keryx ships a Telegram front door: a bot anyone can DM or add to a group. A member types
`/ask …` (in a DM, just the question works), Keryx runs its full paid-source reasoning loop, and
the reply shows the grounded answer, citation allocations and recorded creator-payment
state in USDC on Arc, and a link to the dispatch trace on keryx.cc.

Public production uses Arc mainnet. The bot uses the hosted treasury-funded
research path and carries no caller wallet or payment signer. Pending rewards
and planned allocations remain separate from settled payments. See
[current deployment evidence](mainnet-status.md).

No polling process — Telegram POSTs each update to `https://keryx.cc/api/telegram/webhook`, which
acks immediately, posts a placeholder, and edits it into the answer when the run settles. It is a
thin client over the same treasury-funded free-trial path as the site's no-wallet ask (budget
clamped to `KERYX_ANON_MAX_BUDGET`, rate-limited per Telegram user, tagged `web` with
platform/user attribution). Independent adoption still requires independently
initiated use and recorded evidence; a bot channel alone does not prove it.

## One-time setup (~3 minutes)

1. **Create the bot** — message [@BotFather](https://t.me/BotFather) → `/newbot` → pick a display
   name (**Keryx**) and a username. BotFather replies with the token.
2. **Copy two values into `.env.local`:**
   - the BotFather token → `TELEGRAM_BOT_TOKEN`
   - a random secret → `TELEGRAM_WEBHOOK_SECRET`
     (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
     Telegram echoes it on every update; the endpoint rejects anything else.
3. **Deploy** so the endpoint goes live with both values (`npm run redeploy`).
4. **Register the webhook + commands:**
   ```sh
   npm run register-telegram              # setWebhook + /ask + /help + bot descriptions
   npm run register-telegram -- --delete  # unhook (e.g. to test another deployment)
   ```
   `BASE_URL` decides where the webhook points — it must be public HTTPS, so register against the
   production env, not localhost.
5. **Try it** — DM the bot any question, or add it to a group and type `/ask …`.

## Usage

```
/ask What is x402 and who settles the payment?
just type the question                    # DMs only — no command needed
/help                                     # what Keryx is + usage
```

The placeholder "Keryx is dispatching…" appears instantly; the answer replaces it when the
dispatch completes (typically well under a minute).

## Guardrails

| Concern | Guard |
|---|---|
| Forged webhook calls | `X-Telegram-Bot-Api-Secret-Token` must equal the registered secret, compared constant-time; wrong/missing → 401 |
| Treasury drain | Same clamp as the site free trial: budget ≤ `KERYX_ANON_MAX_BUDGET`, 5/minute per authenticated Telegram user id plus the durable global sponsored allowance (60/minute by default, shared with web/chat/MCP and other bots); counter outages refuse admission |
| Bot loops | Updates from other bots (`from.is_bot`) are ignored, so two bots can't ping-pong the treasury dry |
| HTML injection | Answer and source names are HTML-escaped before `parse_mode: HTML` rendering |
| Unconfigured deploys | Either env var unset → endpoint answers 503, nothing else changes |
| Token hygiene | The bot token never appears in a URL that gets logged; it is read only by the webhook route (outbound calls) and the local register script |

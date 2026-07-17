# Discord Bot Setup — `/ask` in any server

> **The production app is live.** Install it into your server with
> [this link](https://discord.com/oauth2/authorize?client_id=1527619548809924678) and type `/ask`.
> The steps below are only needed to stand up your *own* Discord application (fork / self-host).

Keryx ships a Discord front door: a slash command any server can install. A member types
`/ask question: …`, Keryx runs its full paid-source reasoning loop, and the reply embed shows the
grounded answer, **every creator paid** (weighted USDC citation rewards on Arc testnet), and a link
to the dispatch trace on keryx.cc.

No gateway connection, no separate bot process — Discord POSTs each interaction to
`https://keryx.cc/api/discord/interactions`, which acks within 3 s and edits the reply when the
run settles. It is a thin client over the same treasury-funded free-trial path as the site's
no-wallet ask (budget clamped to `KERYX_ANON_MAX_BUDGET`, rate-limited per Discord user, tagged
`web` in traction — a Discord member is a genuine external asker).

## One-time setup (~5 minutes)

1. **Create the application** — [discord.com/developers/applications](https://discord.com/developers/applications)
   → *New Application* → name it **Keryx**.
2. **Copy three values into `.env.local`:**
   - *General Information → Public Key* → `DISCORD_PUBLIC_KEY` (runtime signature verification)
   - *General Information → Application ID* → `DISCORD_APP_ID` (command registration only)
   - *Bot → Reset Token* → `DISCORD_BOT_TOKEN` (command registration only — never used at runtime)
3. **Deploy** so the endpoint goes live with the public key (`npm run redeploy`).
4. **Register the slash command:**
   ```sh
   npm run register-discord                          # global — propagates in ≤1h
   npm run register-discord -- --guild <server-id>   # one server — instant, good for testing
   ```
5. **Point Discord at the endpoint** — *General Information → Interactions Endpoint URL* →
   `https://keryx.cc/api/discord/interactions` → Save. Discord immediately probes with a PING and
   several invalid signatures; the save only succeeds if the endpoint verifies correctly (so the
   env var from step 2 must already be deployed).
6. **Install it** — *Installation → Guild Install*, scope `applications.commands` only (no bot
   scope needed; the app never joins as a member). Open the install link, pick a server.

## Usage

```
/ask question: What is x402 and who settles the payment?
/ask question: … budget: 0.03        # optional max USDC, clamped server-side
```

The placeholder "Keryx is thinking…" appears instantly; the answer embed replaces it when the
dispatch completes (typically well under a minute; the interaction token allows 15).

## Guardrails

| Concern | Guard |
|---|---|
| Forged webhook calls | Ed25519 signature over every request body (`lib/discord/verify-interaction-signature.ts`); invalid → 401 |
| Treasury drain | Same clamp as the site free trial: budget ≤ `KERYX_ANON_MAX_BUDGET`, `treasuryAsk` rate-limit tier keyed per Discord user id |
| Unconfigured deploys | `DISCORD_PUBLIC_KEY` unset → endpoint answers 503, nothing else changes |
| Token hygiene | `DISCORD_BOT_TOKEN` is used only by the local `register-discord` script; the running app never reads it |

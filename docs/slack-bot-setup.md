# Slack Bot Setup — `/keryx` in any workspace

Keryx ships a Slack front door: a `/keryx` slash command any workspace can install. A member types
`/keryx …`, Keryx runs its full paid-source reasoning loop, and the reply shows the grounded
answer, **every creator paid** (weighted USDC citation rewards on Arc testnet), and a link to the
dispatch trace on keryx.cc.

**No bot token, no scopes, no socket connection.** Slack POSTs each command to
`https://keryx.cc/api/slack/commands`, which acks within 3 s with an ephemeral "dispatching…" note
and posts the answer back over the command's `response_url` when the run settles. It is a thin
client over the same treasury-funded free-trial path as the site's no-wallet ask (budget clamped to
`KERYX_ANON_MAX_BUDGET`, rate-limited per Slack user, tagged `web` in traction — a Slack member is a
genuine external asker).

## One-time setup (~3 minutes)

1. **Create the app from a manifest** — [api.slack.com/apps](https://api.slack.com/apps) →
   *Create New App* → *From a manifest* → pick the workspace → paste the YAML below. It declares only
   the one slash command (no bot user, no OAuth scopes).
   ```yaml
   display_information:
     name: Keryx
     description: Ask a question; Keryx buys paid sources, answers with citations, and pays creators in USDC on Arc.
     background_color: "#c0381c"
   features:
     slash_commands:
       - command: /keryx
         url: https://keryx.cc/api/slack/commands
         description: Buy the right sources, answer with citations, pay every cited creator on-chain
         usage_hint: what is x402?
         should_escape: false
   settings:
     org_deploy_enabled: false
     socket_mode_enabled: false
     token_rotation_enabled: false
   ```
2. **Copy the Signing Secret into `.env.local`** — *Basic Information → App Credentials → Signing
   Secret* → `SLACK_SIGNING_SECRET`. It keys the HMAC the endpoint verifies on every request. That
   is the **only** secret this front door needs — there is deliberately no bot token.
3. **Deploy** so the endpoint goes live with the secret (`npm run redeploy`). `BASE_URL` must be the
   public HTTPS origin the manifest points at (`https://keryx.cc`), not localhost.
4. **Install it** — *Install App → Install to Workspace*. Slack registers `/keryx`; no scopes are
   requested because the manifest declares none.
5. **Try it** — in any channel or DM, type `/keryx what is x402?`.

## Usage

```
/keryx What is x402 and who settles the payment?
/keryx                                    # no question → private usage help
```

The ephemeral "Keryx is dispatching…" note appears only to you and instantly; the in-channel answer
follows when the dispatch completes (typically well under a minute; the `response_url` allows ~30).

## Guardrails

| Concern | Guard |
|---|---|
| Forged requests | `X-Slack-Signature` HMAC-SHA256 over the raw body keyed by the Signing Secret, compared constant-time; wrong → 401 (`lib/slack/verify-request-signature.ts`) |
| Replays | `X-Slack-Request-Timestamp` more than 5 min from now is rejected before the digest is even checked |
| Treasury drain | Same clamp as the site free trial: budget ≤ `KERYX_ANON_MAX_BUDGET`, `treasuryAsk` rate-limit tier keyed per Slack user id |
| SSRF / spam relay | The answer is posted only after confirming the body-supplied `response_url` host is `hooks.slack.com` |
| Markup injection | Answer and source names escape Slack's `& < >` mrkdwn control chars before rendering |
| Unconfigured deploys | `SLACK_SIGNING_SECRET` unset → endpoint answers 503, nothing else changes |
| Secret hygiene | The signing secret and the token-bearing `response_url` are never logged |

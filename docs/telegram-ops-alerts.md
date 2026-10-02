# Telegram operations alerts

The selected destination is a private **Keryx ops** group with the owner and a
dedicated operations bot initially. Add the named incident responder when assigned.
The original notifier implementation did not configure or verify a destination;
the dated acceptance below records subsequent operations evidence.

Create the separate bot through [BotFather](https://core.telegram.org/bots/tutorial),
then create the private group and add the bot with permission to send messages.
Keep its token and the exact group chat ID in the server's private environment file:

```dotenv
KERYX_ALERT_TELEGRAM_BOT_TOKEN=
KERYX_ALERT_TELEGRAM_CHAT_ID=
```

Retrieve and check the group ID privately using an authorized Telegram client or
the [Bot API](https://core.telegram.org/bots/api#getupdates). Never paste a token,
token-bearing API URL, private updates, or chat ID into source, screenshots, logs,
or support conversations. Preserve the negative sign on group IDs. The runtime
accepts numeric IDs and Telegram channel usernames; use the exact private group ID
for this setup. The public `TELEGRAM_BOT_TOKEN` for `/ask` is independent and is
never used as a fallback. Restart each process that sends operations alerts after
changing its environment; configuration is captured at process startup.

## Delivery behavior

Existing operational scripts and reconciliation alerts use `sendAlert`. Telegram
delivery posts plain text to `sendMessage`, limits text to 4000 characters and
uses a four-second timeout covering the HTTP response and acknowledgement. It
requires both HTTP success and Telegram `ok: true`. Redirects, network errors,
timeouts, malformed acknowledgements and Telegram refusals report failure without
throwing or printing response bodies, transport errors or endpoint credentials.
Known configured tokens and webhook URLs are redacted from alert text and logs.
Callers must still keep research content and other secrets out of alert details.

This notifier runs inside Keryx processes. A stopped application or unavailable VPS
cannot report its own outage through it. Mainnet operations acceptance also requires
an outside-host health probe delivering to the selected channel, plus its own
delivery and responder drill; the separately deployed monitor below provides that bounded probe path.

`KERYX_ALERT_WEBHOOK` remains an optional Discord/Slack channel. If both channels
are configured, both are attempted concurrently and **both must acknowledge** for
`sendAlert` to return true. A partial or invalid Telegram pair returns false and
sends nothing to Telegram; an independently configured webhook is still attempted.
No channels returns false. Logs are an observation, not a delivery receipt.
Reconciliation retains its undelivered alert state after failure; a later retry
can duplicate a message in the channel that previously succeeded. No automatic
Telegram retry or fallback destination is introduced.

## Operations acceptance

`npm run preflight:ops` only checks configuration presence and basic shape. It
reports configured channels as **delivery unverified**, fails incomplete/duplicate
assignments, and never prints their values. A passing preflight is not delivery
evidence and does not close the mainnet operations gate.

After the owner configures the private group, separately authorize a harmless
delivery probe and verify receipt in that exact group. Record the candidate commit,
time, confirmed delivery, responsible responder and response expectation without
credentials or private chat identifiers. Then test an alert failure and recovery
with the responder. The original implementation checkpoint used mocked tests only. Subsequent live
evidence is recorded below.

## Observed acceptance - September 30, 2026

The [outside-host monitor acceptance](./outside-host-ops-monitor.md) records the
separate Workers Free monitor, dedicated durable state and actual production
five-minute Cron observation. Its authorized fixed-404 HTTPS diagnostic confirmed
outage and recovery Telegram **[DRILL]** delivery on the first attempt for each.
The owner confirmed receipt of both messages and accepted alert-response ownership.
Diagnostics were then disabled; a later scheduled healthy sample was observed
without another manual POST. Credentials and destination identifiers remain private.

This accepts the tested external delivery/responder boundary. It does not demonstrate
an actual VPS outage, failover, full restore/rollback/key rotation, sustained
availability or durable host NTP synchronization. Those operations gates remain open;
the application notifier behavior above is unchanged.

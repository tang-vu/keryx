/**
 * Slack slash-command endpoint — /keryx from any Slack workspace.
 *
 * Point a Slack app's slash command at this URL (see docs/slack-bot-setup.md); any workspace that
 * installs the app can then ask Keryx in-channel. Keryx runs its full reasoning loop over paid
 * sources and the reply lists every creator paid, with a link to the dispatch trace.
 *
 * Slack demands an HTTP response within 3 seconds, so the route acks immediately with an ephemeral
 * "dispatching…" note and finishes the run in `after()` (the VPS Node process keeps running
 * post-response), then POSTs the answer to the command's `response_url` — no bot token, no scopes,
 * no socket connection.
 *
 * Auth: every request carries an HMAC-SHA256 signature over the raw body keyed by the app's Signing
 * Secret; anything invalid or stale is rejected. Payment model: identical to the site's anonymous
 * free trial — treasury-funded, budget clamped to anonMaxBudget, rate-limited per Slack user id,
 * tagged `web` (a Slack member is a genuine external human asker). Creators are still really paid.
 */

import { NextRequest, after } from "next/server";
import { collectRun } from "@/lib/agent";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyRequestSignature } from "@/lib/slack/verify-request-signature";
import {
  type SlashCommand,
  parseSlashCommand,
  helpText,
  buildAnswerText,
  buildErrorText,
} from "@/lib/slack/ask-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!config.slackSigningSecret) {
    return Response.json({ error: "slack commands not configured" }, { status: 503 });
  }

  // The signature covers the raw bytes, so the body must be read as text and verified before it is
  // parsed as a form — and re-parsed with URLSearchParams over the very same string.
  const signature = req.headers.get("x-slack-signature") ?? "";
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const rawBody = await req.text();
  if (!verifyRequestSignature(config.slackSigningSecret, signature, timestamp, rawBody)) {
    return Response.json({ error: "invalid request signature" }, { status: 401 });
  }

  const cmd = parseSlashCommand(new URLSearchParams(rawBody));
  if (!cmd) return Response.json(ephemeral(helpText())); // bare /keryx → usage help
  if (!config.sellerAddress) {
    return Response.json(ephemeral("Keryx's treasury wallet is not configured on this deployment."));
  }

  // Treasury-funded like the site's free trial — throttle per Slack user, not per IP (every request
  // arrives from Slack's servers, so IPs are useless as a key here).
  const limited = await checkRateLimit(`slack:${cmd.userId}`, "treasuryAsk");
  if (limited) {
    return Response.json(ephemeral("Free dispatches are rate-limited — try again in a minute."));
  }

  const budget = Math.min(config.defaultBudget, config.anonMaxBudget);
  after(() => runAndReply(cmd, budget));
  return Response.json(ephemeral("⏳ Keryx is dispatching — buying sources and settling citations…"));
}

/** Only-the-asker-sees-this reply, for the ack, help, throttles, and config notices. */
function ephemeral(text: string) {
  return { response_type: "ephemeral", text };
}

/** Runs the agent after the ack, then posts the answer (or a failure note) to the response_url. */
async function runAndReply(cmd: SlashCommand, budget: number) {
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
    console.error("[slack] /keryx run failed:", err);
    text = buildErrorText(err);
  }
  await postToResponseUrl(cmd.responseUrl, text);
}

/**
 * Deliver the finished answer in-channel via the command's response_url (valid ~30 min / 5 uses;
 * one post suffices). The URL arrives in the request body, so even though signature verification
 * already gates the request, the host is checked before any outbound fetch — this endpoint must
 * never be turned into an SSRF/spam relay. The response_url carries a secret token, so it is never
 * logged; only failures (and, on host mismatch, the bad host) are.
 */
async function postToResponseUrl(responseUrl: string, text: string) {
  let host: string;
  try {
    host = new URL(responseUrl).host;
  } catch {
    console.error("[slack] response_url is not a valid URL — skipping delivery");
    return;
  }
  if (host !== "hooks.slack.com") {
    console.error(`[slack] refusing to POST to non-Slack response_url host: ${host}`);
    return;
  }
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "in_channel", text }),
    });
    if (!res.ok) console.error(`[slack] response_url post failed: ${res.status}`);
  } catch (err) {
    console.error("[slack] response_url post failed:", err);
  }
}

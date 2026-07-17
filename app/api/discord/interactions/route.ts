/**
 * Discord interactions endpoint — /ask from any Discord server.
 *
 * Point a Discord application's "Interactions Endpoint URL" here and register the /ask command
 * (npm run register-discord); any server that installs the app can then ask Keryx in-channel.
 * Keryx runs its full reasoning loop over paid sources and the reply embed lists every creator
 * paid, with a link to the dispatch trace.
 *
 * Discord demands an ack within 3 seconds, so the route replies with a deferred placeholder and
 * finishes the run in `after()` (the VPS Node process keeps running post-response), then edits
 * the placeholder via the interaction's webhook — no gateway connection, no extra process.
 *
 * Payment model: identical to the site's anonymous free trial — treasury-funded, budget clamped
 * to anonMaxBudget, rate-limited per Discord user id, tagged `web` (a Discord member is a genuine
 * external human asker). Creators are still really paid on-chain.
 */

import { NextRequest, after } from "next/server";
import { collectRun } from "@/lib/agent";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyInteractionSignature } from "@/lib/discord/verify-interaction-signature";
import {
  type AskCommand,
  type Interaction,
  InteractionType,
  parseAskCommand,
  pong,
  deferredResponse,
  ephemeralReply,
  followupUrl,
  buildAnswerMessage,
  buildErrorMessage,
} from "@/lib/discord/ask-interaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!config.discordPublicKey) {
    return Response.json({ error: "discord interactions not configured" }, { status: 503 });
  }

  // The signature covers the raw bytes, so the body must be read as text before parsing.
  const signature = req.headers.get("x-signature-ed25519") ?? "";
  const timestamp = req.headers.get("x-signature-timestamp") ?? "";
  const rawBody = await req.text();
  if (!verifyInteractionSignature(config.discordPublicKey, signature, timestamp, rawBody)) {
    return Response.json({ error: "invalid request signature" }, { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody) as Interaction;
  } catch {
    return Response.json({ error: "malformed interaction body" }, { status: 400 });
  }

  if (interaction.type === InteractionType.Ping) return Response.json(pong());

  const cmd = parseAskCommand(interaction);
  if (!cmd) {
    return Response.json(ephemeralReply("Only `/ask question:<text>` is wired up here."));
  }
  if (!config.sellerAddress) {
    return Response.json(
      ephemeralReply("Keryx's treasury wallet is not configured on this deployment."),
    );
  }

  // Treasury-funded like the site's free trial — throttle per Discord user, not per IP
  // (every request arrives from Discord's servers, so IPs are useless as a key here).
  const limited = await checkRateLimit(`discord:${cmd.userId}`, "treasuryAsk");
  if (limited) {
    return Response.json(
      ephemeralReply("Free dispatches are rate-limited — try again in a minute."),
    );
  }

  const budget = Math.min(cmd.budget ?? config.defaultBudget, config.anonMaxBudget);
  after(() => runAndReply(cmd, budget));
  return Response.json(deferredResponse());
}

/** Runs the agent after the deferred ack is sent, then edits the placeholder with the result. */
async function runAndReply(cmd: AskCommand, budget: number) {
  let message: unknown;
  try {
    const run = await collectRun({
      question: cmd.question,
      budget,
      queryId: crypto.randomUUID(),
      origin: "web",
    });
    message = buildAnswerMessage(run);
  } catch (err) {
    console.error("[discord] /ask run failed:", err);
    message = buildErrorMessage(err);
  }
  try {
    const res = await fetch(followupUrl(cmd.applicationId, cmd.token), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      console.error(
        `[discord] follow-up edit failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  } catch (err) {
    console.error("[discord] follow-up edit failed:", err);
  }
}

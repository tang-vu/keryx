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
import { prepareHostedRunClaim } from "@/lib/run-claims/hosted-delivery";
import { privateRunClaimText } from "@/lib/run-claims/delivery";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { chatControlReply, exactChatControl, linkedChatOwner } from "@/lib/chat-accounts/service";
import { discordChatRecipient } from "@/lib/chat-accounts/provider-recipient";
import type { ChatRecipient } from "@/lib/chat-accounts/contracts";
import { botResearchMessages } from "@/lib/bots/research-messages";
import { botControlResponse } from "@/lib/bots/language";
import { botAnswerPresentation } from "@/lib/bots/answer-preference";
import { checkSponsoredResearchAdmission } from "@/lib/sponsored-admission";
import { verifyInteractionSignature } from "@/lib/discord/verify-interaction-signature";
import {
  type AskCommand,
  type Interaction,
  InteractionType,
  parseAskCommand,
  parseControlCommand,
  helpText,
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

  // Exact reserved intents refuse before preference, research or sponsored admission.
  if (interaction.type === InteractionType.ApplicationCommand && /^(?:link|unlink|whoami)(?:\s|$)/u.test(interaction.data?.name ?? "")) {
    const recipient = discordChatRecipient(interaction), command = exactChatControl(interaction.data?.name ?? "");
    let text = "Discord account linking is unavailable. This command did not read or change an account binding.";
    if (recipient && command && (!interaction.data?.options || interaction.data.options.length === 0)) {
      try { text = await chatControlReply({ command, recipient, db: getDb,
        binding: { origin: new URL(config.baseUrl).origin, network: config.networkId } }); }
      catch { /* No token, provider or database error is reflected. */ }
    }
    return Response.json({ type: 4, data: { content: text, flags: 68, allowed_mentions: { parse: [] } } });
  }

  const control = parseControlCommand(interaction);
  if (control) {
    const reply = await botControlResponse({ control, platformLocale: interaction.locale,
      recipient: { platform: "discord", scope: interaction.application_id!, userId: interaction.member?.user?.id ?? interaction.user?.id ?? "" } });
    return Response.json(ephemeralReply(control.action === "help" ? helpText(reply.language) : reply.text));
  }

  const cmd = parseAskCommand(interaction);
  if (!cmd) {
    return Response.json(ephemeralReply(botResearchMessages()("discordUsage")));
  }
  cmd.presentationLanguage = (await botAnswerPresentation(cmd.question, { platform: "discord", scope: cmd.applicationId, userId: cmd.userId })).language;
  if (!config.sellerAddress) {
    return Response.json(
      ephemeralReply(botResearchMessages(cmd.question, cmd.presentationLanguage)("treasuryUnavailable")),
    );
  }

  // Treasury-funded like the site's free trial — throttle per Discord user, not per IP
  // (every request arrives from Discord's servers, so IPs are useless as a key here).
  const limited = await checkSponsoredResearchAdmission({ kind: "bot", platform: "discord", userId: cmd.userId });
  if (limited) {
    return Response.json(
      ephemeralReply(botResearchMessages(cmd.question, cmd.presentationLanguage)("sponsoredLimited")),
    );
  }

  const budget = Math.min(cmd.budget ?? config.defaultBudget, config.anonMaxBudget);
  after(() => runAndReply(cmd, budget, discordChatRecipient(interaction, true)));
  return Response.json(deferredResponse());
}

/** Runs the agent after the deferred ack is sent, then edits the placeholder with the result. */
async function runAndReply(cmd: AskCommand, budget: number, recipient: ChatRecipient | null) {
  let message: unknown;
  try {
    const queryId = crypto.randomUUID();
    const owner = recipient ? await linkedChatOwner(await getDb(), recipient,
      { origin: new URL(config.baseUrl).origin, network: config.networkId }) : undefined;
    const privateClaim = await prepareHostedRunClaim(queryId, owner);
    const run = await collectRun({
      question: cmd.question,
      ...(cmd.presentationLanguage ? { presentationLanguage: cmd.presentationLanguage } : {}),
      budget,
      queryId,
      origin: "web",
      ...(owner ? { asker: owner } : {}),
      fundingOwner: "treasury",
      provenance: { version: 1, surface: "discord", ownershipMethod: "unknown" },
    });
    const packet = await privateClaim?.complete(run);
    message = { ...buildAnswerMessage(run, cmd.presentationLanguage), ...(packet ? { content: privateRunClaimText(packet), allowed_mentions: { parse: [] } } : {}) };
  } catch (err) {
    console.error("[discord] /ask run failed:", err);
    message = buildErrorMessage(err, cmd.question, cmd.presentationLanguage);
  }
  try {
    const res = await fetch(followupUrl(cmd.applicationId, cmd.token), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      console.error(
        `[discord] follow-up edit failed: ${res.status}`,
      );
    }
  } catch (err) {
    console.error("[discord] follow-up edit failed", err instanceof Error ? err.name : "DeliveryError");
  }
}

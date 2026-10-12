/**
 * Discord /ask interaction ↔ Keryx mappers (pure, side-effect free).
 *
 * Discord's interactions webhook lets any server install Keryx as a slash command: a member
 * types /ask, Keryx runs its full paid-source reasoning loop, and the reply lists every creator
 * paid for the answer. The route (app/api/discord/interactions) owns signature verification,
 * rate-limits, and the agent run; this module only translates shapes so both stay small and the
 * translation stays unit-testable — the same split as lib/openai-compat.
 */

import { config } from "../config";
import { unsupportedDecisionReviewFlag } from "../research/decision-review-types";
import { formatRecordedUsdc, formatNumber, selectPlural } from "../i18n/format";
import { answerPresentation } from "../research/answer-presentation";
import { botResearchFailure, botResearchMessages } from "../bots/research-messages";
import { botControlsCatalogues, type BotControl, type BotLanguage } from "../bots/language";
import { botHelpEnglish } from "../../locales/en/bot-research";
import type { QueryRun } from "../types";

// Discord wire constants — the two interaction types and three callback types this flow uses.
export const InteractionType = { Ping: 1, ApplicationCommand: 2 } as const;
export const CallbackType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
} as const;

/** Discord message flag: visible only to the invoking user. */
const EPHEMERAL = 64;

// Vermillion herald's seal — the Mint accent (app/globals.css --seal).
const EMBED_COLOR = 0xc0381c;

interface CommandOption {
  name?: string;
  value?: unknown;
}

/** The slice of a Discord interaction payload the /ask flow reads. */
export interface Interaction {
  type?: number;
  application_id?: string;
  token?: string;
  locale?: string;
  data?: { name?: string; options?: CommandOption[] };
  // Guild invocations carry the user under `member.user`; DM invocations under `user`.
  member?: { user?: { id?: string } };
  user?: { id?: string };
}

export interface AskCommand {
  question: string;
  budget?: number;
  userId: string;
  applicationId: string;
  token: string;
}

/** Extract the /ask command from an interaction, or null when it isn't a usable /ask. */
export function parseAskCommand(interaction: Interaction): AskCommand | null {
  if (interaction.type !== InteractionType.ApplicationCommand) return null;
  if (interaction.data?.name !== "ask") return null;
  if (!interaction.application_id || !interaction.token) return null;

  const options = interaction.data.options ?? [];
  if (options.some(option => !["question", "budget"].includes(option.name ?? ""))) return null;
  const question =
    typeof optionValue(options, "question") === "string"
      ? (optionValue(options, "question") as string).trim()
      : "";
  if (!question || unsupportedDecisionReviewFlag(question)) return null;

  const rawBudget = optionValue(options, "budget");
  const budget =
    typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget > 0
      ? rawBudget
      : undefined;

  return {
    question,
    budget,
    userId: interaction.member?.user?.id ?? interaction.user?.id ?? "unknown",
    applicationId: interaction.application_id,
    token: interaction.token,
  };
}

function optionValue(options: CommandOption[], name: string): unknown {
  return options.find((o) => o.name === name)?.value;
}

/** Registered control commands never enter sponsored research admission. */
export function parseControlCommand(interaction: Interaction): BotControl | null {
  if (interaction.type !== InteractionType.ApplicationCommand || !interaction.application_id || !interaction.token) return null;
  const name = interaction.data?.name;
  if (name !== "help" && name !== "language") return null;
  const options = interaction.data?.options ?? [], option = name === "help" ? "language" : "value";
  if (options.length > 1 || options.some(item => item.name !== option || typeof item.value !== "string")) return null;
  return { action: name, ...(options.length ? { value: options[0].value as string } : {}) };
}

export function helpText(language: BotLanguage = "en") {
  const copy = botControlsCatalogues[language];
  return ["Keryx", copy.introduction, copy.financialDetails, botHelpEnglish.slackExplanation,
    `${copy.usage} \`/ask question:<text>\``, copy.reviewBoundary, copy.languageHelp, `${copy.status} ${config.baseUrl}/status`].join("\n\n");
}

/** Immediate ack for Discord's URL-validation ping. */
export function pong() {
  return { type: CallbackType.Pong };
}

/** "Keryx is thinking…" placeholder — buys the run time beyond Discord's 3s response window. */
export function deferredResponse() {
  return { type: CallbackType.DeferredChannelMessage, data: { flags: EPHEMERAL } };
}

/** Only-you-can-see-this reply, for errors and throttles that shouldn't clutter the channel. */
export function ephemeralReply(content: string) {
  return {
    type: CallbackType.ChannelMessage,
    data: { content: truncate(content, 2000), flags: EPHEMERAL },
  };
}

/** Where to PATCH the deferred placeholder once the run finishes (valid for 15 minutes). */
export function followupUrl(applicationId: string, token: string): string {
  return `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
}

/**
 * The finished answer as a single embed: grounded answer, the creators actually paid, and a link
 * to the full dispatch trace. Discord caps embed descriptions at 4096 and any field value at 1024,
 * so both are truncated with the dispatch page carrying the full text.
 */
export function buildAnswerMessage(run: QueryRun) {
  const message = botResearchMessages(run.question);
  const locale = answerPresentation(run.question, "ordinary").language;
  const fields = [];
  if (run.citations.length > 0) {
    const lines = run.citations.map(
      (c) => `${c.sourceName} — ${formatRecordedUsdc(c.reward, { minimumFractionDigits: 4 }, locale)} (${message("weight", { weight: formatNumber(c.weight, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, locale) })})`,
    );
    fields.push({
      name: message("citationHeading"),
      value: truncate(lines.join("\n"), 1024),
    });
  }
  return {
    embeds: [
      {
        title: truncate(run.question, 256),
        description: truncate(run.answer, 3500),
        url: `${config.baseUrl}/dispatch/${run.id}`,
        color: EMBED_COLOR,
        fields,
        footer: {
          text:
            `Keryx · ${message(run.citations.length > 0 && selectPlural(run.citations.length, locale) === "one" ? "sourcesOne" : "sourcesOther", { count: run.citations.length })}` +
            ` · ${message("recordedCreators", { amount: formatRecordedUsdc(run.totalToCreators, { minimumFractionDigits: 4 }, locale) })} (${run.paymentMode ?? "legacy"}) · ${message("discordSettlementNotice")}`,
        },
      },
    ],
  };
}

/** Failure text for the deferred placeholder — the run died, say so instead of hanging forever. */
export function buildErrorMessage(err: unknown, originalQuestion = "") {
  return { content: truncate(botResearchFailure(err, originalQuestion), 2000) };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

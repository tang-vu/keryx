/**
 * Slack /keryx slash command ↔ Keryx mappers (pure, side-effect free).
 *
 * Slack POSTs a slash command as application/x-www-form-urlencoded — no bot token, no scopes: the
 * reply rides back over the command's `response_url`. A member types `/keryx …`, Keryx runs its
 * full paid-source reasoning loop, and the reply lists citations and planned rewards. The route
 * (app/api/slack/commands) owns signature verification, rate-limits, and the agent run; this module
 * only translates shapes so both stay small and the translation stays unit-testable — the same
 * split as lib/telegram and lib/discord.
 */

import { config } from "../config";
import { unsupportedDecisionReviewFlag, unsupportedDecisionReviewIntent } from "../research/decision-review-types";
import { formatRecordedUsdc } from "../display/recorded-usdc";
import { botResearchFailure, botResearchMessages } from "../bots/research-messages";
import { botHelpEnglish } from "../../locales/en/bot-research";
import type { QueryRun } from "../types";

/** Slack renders a message's `text` up to 40k chars; keep the whole payload well under that and the
 *  answer bounded — the dispatch page always carries the full, untruncated text. */
const ANSWER_MAX = 3000;
const MESSAGE_MAX = 12000;

/** The fields the /keryx flow reads from Slack's urlencoded slash-command payload. */
export interface SlashCommand {
  question: string;
  userId: string;
  channelId: string;
  responseUrl: string;
  command: string;
}

/**
 * Pull the /keryx command out of the parsed form body, or null when there's no question. Slack
 * always sends the whole payload; a blank `text` means the user typed just `/keryx`, which the
 * route answers with usage help. Missing user id falls back to a shared bucket rather than failing.
 */
export function parseSlashCommand(params: URLSearchParams): SlashCommand | null {
  const question = (params.get("text") ?? "").trim();
  if (!question || unsupportedDecisionReviewFlag(question) || unsupportedDecisionReviewIntent(Object.fromEntries(params))) return null;
  return {
    question,
    userId: (params.get("user_id") ?? "").trim() || "unknown",
    channelId: (params.get("channel_id") ?? "").trim(),
    responseUrl: (params.get("response_url") ?? "").trim(),
    command: (params.get("command") ?? "").trim() || "/keryx",
  };
}

export function helpText(): string {
  return [
    `*${botHelpEnglish.herald}* — ${botHelpEnglish.tagline}`,
    "",
    botHelpEnglish.slackExplanation,
    "",
    botHelpEnglish.slackUsage,
    botHelpEnglish.reviewBoundary,
    "",
    `${botHelpEnglish.slackStatus} ${config.baseUrl}/status`,
  ].join("\n");
}

/**
 * The finished answer as one Slack mrkdwn message: bold question, grounded answer, the creators
 * planned rewards, recorded payment mode, and a link to the full dispatch trace (which carries
 * settlement evidence and any truncated text). QueryRun alone does not contain per-payment evidence.
 */
export function buildAnswerText(run: QueryRun): string {
  const message = botResearchMessages(run.question);
  const parts = [`*${escapeSlack(truncate(run.question, 256))}*`, ""];
  parts.push(escapeSlack(truncate(run.answer, ANSWER_MAX)), "");

  if (run.citations.length > 0) {
    parts.push(`*${message("slackCitationHeading")}*`);
    for (const c of run.citations) {
      parts.push(
        escapeSlack(`${c.sourceName} — ${formatRecordedUsdc(c.reward, { minimumFractionDigits: 4 })} (${message("weight", { weight: c.weight.toFixed(2) })})`),
      );
    }
    parts.push("");
  }

  parts.push(
    `${message(run.citations.length === 1 ? "sourcesOne" : "sourcesOther", { count: run.citations.length })} · ${message("recordedCreatorTotal", { amount: formatRecordedUsdc(run.totalToCreators, { minimumFractionDigits: 4 }) })} / ${run.paymentMode ?? "legacy"}`,
    message("slackSettlementNotice"),
    message("fullTrace", { url: `${config.baseUrl}/dispatch/${run.id}` }),
  );
  return truncate(parts.join("\n"), MESSAGE_MAX);
}

/** Failure text for the response_url post — the run died, say so instead of leaving it silent. */
export function buildErrorText(err: unknown, originalQuestion = ""): string {
  return truncate(escapeSlack(botResearchFailure(err, originalQuestion)), MESSAGE_MAX);
}

/**
 * Escape the three characters Slack treats as mrkdwn control chars in interpolated content
 * (`&` first, so the entities it introduces aren't re-escaped). Our own `*bold*` markup is written
 * around already-escaped text, so it renders while creator-supplied text can't inject formatting.
 */
function escapeSlack(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

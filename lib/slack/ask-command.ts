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
import { recordedAnswerLanguage } from "../research/answer-language-provenance";
import { unsupportedDecisionReviewFlag, unsupportedDecisionReviewIntent } from "../research/decision-review-types";
import { formatRecordedUsdc, formatNumber, selectPlural } from "../i18n/format";
import { answerPresentation } from "../research/answer-presentation";
import { botResearchFailure, botResearchMessages } from "../bots/research-messages";
import { botHelpEnglish } from "../../locales/en/bot-research";
import { botControlsCatalogues, type BotLanguage } from "../bots/language";
import type { QueryRun } from "../types";

/** Slack renders a message's `text` up to 40k chars; keep the whole payload well under that and the
 *  answer bounded — the dispatch page always carries the full, untruncated text. */
const ANSWER_MAX = 3000;
const MESSAGE_MAX = 12000;

/** The fields the /keryx flow reads from Slack's urlencoded slash-command payload. */
export interface SlashCommand {
  /** Authenticated route preference only; never parsed from slash-command fields. */
  presentationLanguage?: BotLanguage;
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

export function helpText(language: BotLanguage = "en"): string {
  const copy = botControlsCatalogues[language];
  return [
    `*${botHelpEnglish.herald}*${language === "en" ? ` — ${botHelpEnglish.tagline}` : ""}`,
    "",
    ...(language === "en" ? [] : [copy.introduction, copy.financialDetails]),
    botHelpEnglish.slackExplanation,
    "",
    `${copy.usage} \`/keryx ${copy.exampleQuestion}\``,
    copy.reviewBoundary,
    copy.languageHelp,
    "",
    `${language === "en" ? botHelpEnglish.slackStatus : copy.status} ${config.baseUrl}/status`,
  ].join("\n");
}

/**
 * The finished answer as one Slack mrkdwn message: bold question, grounded answer, the creators
 * planned rewards, recorded payment mode, and a link to the full dispatch trace (which carries
 * settlement evidence and any truncated text). QueryRun alone does not contain per-payment evidence.
 */
export function buildAnswerText(run: QueryRun, requestedLanguage?: BotLanguage): string {
  const locale = recordedAnswerLanguage(run) ?? requestedLanguage ?? answerPresentation(run.question, "ordinary").language;
  const message = botResearchMessages(run.question, locale);
  const parts = [`*${escapeSlack(truncate(run.question, 256))}*`, ""];
  parts.push(escapeSlack(truncate(run.answer, ANSWER_MAX)), "");

  if (run.citations.length > 0) {
    parts.push(`*${message("slackCitationHeading")}*`);
    for (const c of run.citations) {
      parts.push(
        escapeSlack(`${c.sourceName} — ${formatRecordedUsdc(c.reward, { minimumFractionDigits: 4 }, locale)} (${message("weight", { weight: formatNumber(c.weight, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, locale) })})`),
      );
    }
    parts.push("");
  }

  parts.push(
    `${message(run.citations.length > 0 && selectPlural(run.citations.length, locale) === "one" ? "sourcesOne" : "sourcesOther", { count: run.citations.length })} · ${message("recordedCreatorTotal", { amount: formatRecordedUsdc(run.totalToCreators, { minimumFractionDigits: 4 }, locale) })} / ${run.paymentMode ?? "legacy"}`,
    message("slackSettlementNotice"),
    message("fullTrace", { url: `${config.baseUrl}/dispatch/${run.id}` }),
  );
  return truncate(parts.join("\n"), MESSAGE_MAX);
}

/** Failure text for the response_url post — the run died, say so instead of leaving it silent. */
export function buildErrorText(err: unknown, originalQuestion = "", requestedLanguage?: BotLanguage): string {
  return truncate(escapeSlack(botResearchFailure(err, originalQuestion, requestedLanguage)), MESSAGE_MAX);
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

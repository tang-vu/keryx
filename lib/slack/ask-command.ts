/**
 * Slack /keryx slash command ↔ Keryx mappers (pure, side-effect free).
 *
 * Slack POSTs a slash command as application/x-www-form-urlencoded — no bot token, no scopes: the
 * reply rides back over the command's `response_url`. A member types `/keryx …`, Keryx runs its
 * full paid-source reasoning loop, and the reply lists every creator paid. The route
 * (app/api/slack/commands) owns signature verification, rate-limits, and the agent run; this module
 * only translates shapes so both stay small and the translation stays unit-testable — the same
 * split as lib/telegram and lib/discord.
 */

import { config } from "../config";
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
  if (!question) return null;
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
    "*Keryx* — the citation-toll research herald.",
    "",
    "Ask a question and Keryx buys the right paid sources, answers with citations, and pays " +
      "every cited creator in USDC on Arc — really, on-chain.",
    "",
    "Usage: `/keryx what is x402?`",
    "",
    `Creators keep 100%. Live traction: ${config.baseUrl}/status`,
  ].join("\n");
}

/**
 * The finished answer as one Slack mrkdwn message: bold question, grounded answer, the creators
 * actually paid, and a link to the full dispatch trace (which carries any truncated text).
 */
export function buildAnswerText(run: QueryRun): string {
  const parts = [`*${escapeSlack(truncate(run.question, 256))}*`, ""];
  parts.push(escapeSlack(truncate(run.answer, ANSWER_MAX)), "");

  if (run.citations.length > 0) {
    parts.push("*Creators paid — weighted USDC citation rewards on Arc testnet*");
    for (const c of run.citations) {
      parts.push(
        escapeSlack(`${c.sourceName} — $${c.reward.toFixed(4)} (weight ${c.weight.toFixed(2)})`),
      );
    }
    parts.push("");
  }

  const plural = run.citations.length === 1 ? "" : "s";
  parts.push(
    `${run.citations.length} creator${plural} paid · $${run.totalToCreators.toFixed(4)} to creators`,
    `Full trace: ${config.baseUrl}/dispatch/${run.id}`,
  );
  return truncate(parts.join("\n"), MESSAGE_MAX);
}

/** Failure text for the response_url post — the run died, say so instead of leaving it silent. */
export function buildErrorText(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return truncate(`⚠️ Keryx could not finish this dispatch: ${escapeSlack(detail)}`, MESSAGE_MAX);
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

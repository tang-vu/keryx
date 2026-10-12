import { sha256, stringToHex } from "viem";
import type { QueryRun } from "../types";
import type { ProposedEvidence } from "../llm/reasoning-engine";
import type { CitedStatement } from "../agent/cited-statements";
import { reviewedStatementLanguage } from "./answer-language-review";
import type { PresentationLanguage } from "./presentation-language";

export interface AnswerLanguageProvenance {
  format: "keryx-answer-language-v1";
  scope: "generated-prose";
  language: PresentationLanguage;
  method: "deterministic-renderer" | "reviewed-statements-and-renderer";
  answerSha256: `0x${string}`;
}
const digest = (answer: string) => sha256(stringToHex(answer));

/** Finalizer only: renderer language is observed from the selected code branch.
 * Every delivered model sentence must have an independent language observation.
 * Original quotes, research topics and machine/financial fields are outside scope.
 * Call after all final answer projections, never from request JSON or a prompt. */
export function finalizeAnswerLanguage(input: { answer: string; rendererLanguage: PresentationLanguage;
  statements: readonly CitedStatement[]; proposals: readonly ProposedEvidence[] }): AnswerLanguageProvenance | undefined {
  if (!input.answer || !["en", "vi", "pt", "es"].includes(input.rendererLanguage)) return undefined;
  for (const statement of input.statements) {
    const rows = input.proposals.filter(row => row.claimIndex === statement.claimIndex && row.marker === statement.marker &&
      row.quote.trim() === statement.quote && row.statement === statement.text);
    if (rows.length !== 1 || reviewedStatementLanguage(rows[0]) !== input.rendererLanguage) return undefined;
  }
  return { format: "keryx-answer-language-v1", scope: "generated-prose", language: input.rendererLanguage,
    method: input.statements.length ? "reviewed-statements-and-renderer" : "deterministic-renderer", answerSha256: digest(input.answer) };
}

/** Read the trusted producer's existing stored trace envelope. No schema/backfill.
 * Absent, conflicting, future, malformed or answer-mismatched records stay unknown.
 * A digest binds bytes, not source authenticity or human approval. */
export function recordedAnswerLanguage(run: Pick<QueryRun, "answer" | "trace">): PresentationLanguage | undefined {
  if (typeof run.answer !== "string") return undefined;
  const packets = (Array.isArray(run.trace) ? run.trace : []).filter(step => step.phase === "done" &&
    step.detail && typeof step.detail === "object" && Object.hasOwn(step.detail, "answerLanguage"))
    .map(step => (step.detail as { answerLanguage: unknown }).answerLanguage);
  if (packets.length !== 1) return undefined;
  const packet = packets[0];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return undefined;
  const p = packet as Record<string, unknown>;
  if (Object.keys(p).sort().join(",") !== "answerSha256,format,language,method,scope" ||
    p.format !== "keryx-answer-language-v1" || p.scope !== "generated-prose" ||
    !["en", "vi", "pt", "es"].includes(String(p.language)) ||
    !["deterministic-renderer", "reviewed-statements-and-renderer"].includes(String(p.method)) ||
    p.answerSha256 !== digest(run.answer)) return undefined;
  return p.language as PresentationLanguage;
}

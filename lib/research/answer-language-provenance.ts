import { sha256, stringToHex } from "viem";
import type { QueryRun } from "../types";
import type { ProposedEvidence } from "../llm/reasoning-engine";
import type { CitedStatement } from "../agent/cited-statements";
import { reviewedStatementLanguage } from "./answer-language-review";
import type { PresentationLanguage } from "./presentation-language";
import { isPresentationLanguage } from "../../shared/i18n/presentation-language";

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
  if (!input.answer || !isPresentationLanguage(input.rendererLanguage)) return undefined;
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
function recordedAnswerLanguagePacket(run: Pick<QueryRun, "answer" | "trace">): AnswerLanguageProvenance | undefined {
  if (typeof run.answer !== "string") return undefined;
  const packets = (Array.isArray(run.trace) ? run.trace : []).filter(step => step && typeof step === "object" && step.phase === "done" &&
    step.detail && typeof step.detail === "object" && Object.hasOwn(step.detail, "answerLanguage"))
    .map(step => (step.detail as { answerLanguage: unknown }).answerLanguage);
  if (packets.length !== 1) return undefined;
  return readAnswerLanguagePacket(packets[0], run.answer);
}

/** Shared closed-schema validation for stored and completed transport packets. */
function readAnswerLanguagePacket(packet: unknown, answer: string): AnswerLanguageProvenance | undefined {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return undefined;
  const p = packet as Record<string, unknown>;
  if (Object.keys(p).sort().join(",") !== "answerSha256,format,language,method,scope" ||
    p.format !== "keryx-answer-language-v1" || p.scope !== "generated-prose" ||
    !isPresentationLanguage(p.language) ||
    (p.method !== "deterministic-renderer" && p.method !== "reviewed-statements-and-renderer") ||
    p.answerSha256 !== digest(answer)) return undefined;
  return { format: "keryx-answer-language-v1", scope: "generated-prose", language: p.language as PresentationLanguage,
    method: p.method, answerSha256: p.answerSha256 as AnswerLanguageProvenance["answerSha256"] };
}

export function recordedAnswerLanguage(run: Pick<QueryRun, "answer" | "trace">): PresentationLanguage | undefined {
  return recordedAnswerLanguagePacket(run)?.language;
}

export interface CompletedAnswerLanguageProvenance extends AnswerLanguageProvenance { queryId: string }

/** Project only an existing valid trusted producer packet, after the final answer projection.
 * No trace, approval, generation authority or historical backfill enters the public packet. */
export function projectCompletedAnswerLanguage(run: Pick<QueryRun, "id" | "answer" | "trace">): CompletedAnswerLanguageProvenance | undefined {
  if (typeof run.id !== "string" || !run.id) return undefined;
  const packet = recordedAnswerLanguagePacket(run);
  return packet ? { ...packet, queryId: run.id } : undefined;
}

/** Caller must supply the query identity already verified by the completed delivery path.
 * The digest establishes exact bytes, not independent origin, settlement or human approval. */
export function readCompletedAnswerLanguage(packet: unknown, queryId: unknown, answer: unknown): CompletedAnswerLanguageProvenance | undefined {
  if (typeof queryId !== "string" || !queryId || typeof answer !== "string" ||
    !packet || typeof packet !== "object" || Array.isArray(packet)) return undefined;
  const p = packet as Record<string, unknown>;
  if (Object.keys(p).sort().join(",") !== "answerSha256,format,language,method,queryId,scope" || p.queryId !== queryId) return undefined;
  const { queryId: _queryId, ...provenance } = p;
  const valid = readAnswerLanguagePacket(provenance, answer);
  return valid ? { ...valid, queryId } : undefined;
}

import { MAX_RESEARCH_TARGETS } from "./research-target-limits";
import { researchAdmissionError } from "../research/availability-contract";
import { ReasoningOutputValidationError, outputTokenLimitFromValidatedError } from "./reasoning-engine";
import { ResearchSelectionError } from "./research-selection";

export type PlanningRefusalReason = "expanded_output" | "invalid_output" | "needs_refinement";

/** Suggestions are caller-text excerpts, not model-authored targets or executable retries. */
function refinementChoices(question: string): string[] {
  const safe = question.slice(0, 30_000)
    .replace(/https?:\/\/[^\s<>"'`]+/giu, "[source URL in original request]")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, " ");
  // A short "subjects: dimension, dimension, dimension" request can offer one
  // dimension at a time without losing later dimensions or trailing conditions.
  // These are caller excerpts, not inferred targets or an automatically run plan.
  const colon = safe.lastIndexOf(":");
  if (colon >= 0) {
    const context = safe.slice(0, colon).split(/(?<=[.!?])\s+|\r?\n+/u).at(-1)?.trim();
    const [list, ...conditions] = safe.slice(colon + 1).trim().split(/(?<=[.!?])\s+/u);
    const dimensions = list.split(/,\s+(?!\d)|;\s*/u).map(part => part.trim());
    if (context && dimensions.length >= 2 && dimensions.length <= 3 && dimensions.every(part => part.length >= 12)) {
      const suffix = conditions.length ? " " + conditions.join(" ") : "";
      const choices = [...new Set(dimensions.map(part => `${context}: ${part.replace(/[.!?]$/u, "")}.${suffix}`))];
      if (choices.every(choice => choice.length <= 240)) return choices;
    }
  }
  const parts = safe.split(/(?<=[?;])\s*|\r?\n+|,\s+(?!\d)/u)
    .map(part => part.trim()).filter(part => part.length >= 12);
  return [...new Set(parts)].slice(0, 3).map(part => {
    if (part.length <= 240) return part;
    const prefix = part.slice(0, 240).replace(/[\uD800-\uDBFF]$/u, "");
    return prefix.replace(/\s+\S*$/u, "") + "…";
  });
}

/** Terminal, request-local planning refusal. Never retry another paid tier for this outcome. */
export class ResearchPlanningError extends ReasoningOutputValidationError {
  readonly status = 422;
  readonly code = "research_plan_refinement_required";
  readonly maximumTargets = MAX_RESEARCH_TARGETS;
  #scopeChoices: readonly string[];
  get scopeChoices(): readonly string[] { return this.#scopeChoices; }
  readonly language: "vi" | "en";

  constructor(question: string, readonly reason: PlanningRefusalReason, outputTokenLimit?: number) {
    const vi = /[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u.test(question);
    const message = reason === "expanded_output"
      ? vi
        ? `Kế hoạch do model đề xuất vượt ${MAX_RESEARCH_TARGETS} targets; chưa lập được kế hoạch đầy đủ trong giới hạn.`
        : `The proposed research plan exceeded ${MAX_RESEARCH_TARGETS} targets; a complete bounded plan could not be prepared.`
      : vi
        ? `Chưa lập được kế hoạch hợp lệ với tối đa ${MAX_RESEARCH_TARGETS} yêu cầu nghiên cứu độc lập.`
        : `A valid plan with at most ${MAX_RESEARCH_TARGETS} independent research targets could not be prepared.`;
    // Keep private question excerpts out of Error.message, telemetry and server error logs.
    super(message + (vi
      ? " Hãy chọn một đối tượng hoặc một khía cạnh so sánh cho mỗi câu hỏi, giữ các URL/phiên bản và điều kiện nguồn của yêu cầu gốc."
      : " Choose one comparison subject or dimension per question, keeping the original source URLs/versions and qualifications."), outputTokenLimit);
    this.language = vi ? "vi" : "en";
    this.#scopeChoices = Object.freeze(refinementChoices(question));
  }
}

type ComparisonRole = "subject" | "dimension" | "shared" | "scope" | "framing";
interface ComparisonPart { text: string; role: ComparisonRole }

/** Recover only boundary whitespace, never missing wording or punctuation.
 * Models commonly trim string values. Rebind each remaining exact span to the
 * caller in order so this tolerance cannot omit qualifications or rewrite URLs.
 */
function callerComparisonParts(question: string, parts: ComparisonPart[]): ComparisonPart[] | null {
  if (parts.map(part => part.text).join("") === question) return parts;
  if (question.length > 64 * 600) return null;
  const restored: ComparisonPart[] = [];
  let offset = 0;
  for (const part of parts) {
    const text = part.text.trim();
    if (!text) { if (part.role !== "framing") return null; continue; }
    const whitespace = question.slice(offset).match(/^\s*/u)![0];
    if (whitespace) { restored.push({ text: whitespace, role: "framing" }); offset += whitespace.length; }
    if (!question.startsWith(text, offset)) return null;
    restored.push({ text, role: part.role }); offset += text.length;
  }
  const trailing = question.slice(offset);
  if (trailing.trim()) return null;
  if (trailing) restored.push({ text: trailing, role: "framing" });
  return restored;
}

/** Private proposal from the same planning response, never an answer or a repair call.
 * Exact, ordered caller parts prevent foreign wording or an omitted span from being
 * silently accepted. Role classification is still the model's semantic proposal;
 * provenance alone cannot establish that it classified every requested need correctly.
 */
function comparisonResearchPlan(question: string, raw: unknown, constraints: readonly string[]): string[] {
  const invalid = (): never => { throw new ResearchPlanningError(question, "invalid_output"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const proposal = raw as Record<string, unknown>;
  const roles: readonly string[] = ["subject", "dimension", "shared", "scope", "framing"];
  if (Object.keys(proposal).some(key => key !== "parts") || !Array.isArray(proposal.parts) ||
    proposal.parts.length === 0 || proposal.parts.length > 64 || !proposal.parts.every(part =>
      part && typeof part === "object" && !Array.isArray(part) && Object.keys(part).length === 2 &&
      typeof part.text === "string" && part.text.length > 0 && part.text.length <= 600 && part.text.isWellFormed() &&
      typeof part.role === "string" && roles.includes(part.role))) return invalid();
  const parts = callerComparisonParts(question, proposal.parts as ComparisonPart[]);
  if (!parts) return invalid();
  const texts = (role: ComparisonRole) => parts.filter(part => part.role === role).map(part => part.text.trim());
  const subjects = texts("subject"), dimensions = texts("dimension"), shared = texts("shared");
  const scope = texts("scope");
  // A transport may repeat a caller scope span in the ordinary constraints key.
  // Accept only that exact redundant scope, which every constructed target retains.
  if (constraints.some(constraint => !scope.includes(constraint.trim()))) return invalid();
  const needs = [...subjects, ...dimensions, ...shared];
  if (subjects.length < 2 || !dimensions.length || needs.some(text => !text) ||
    new Set(needs).size !== needs.length || subjects.some(text => /https?:\/\//iu.test(text))) return invalid();
  // References and caller conditions must survive every constructed need. They
  // are not additional subjects or queries, and format/connective parts stay in
  // the original question instead of acquiring factual target authority.
  // Scan complete caller URL tokens, including repeated references, with the
  // requestedSourceUrls matching/prose-closer bounds. The partition bounds the
  // whole question to 64 parts of 600 characters; do not truncate this scan.
  // One scope part must contain each whole token so trimming/joining scope
  // cannot drop a split scheme or insert spaces inside a host/path.
  let offset = 0;
  const scopeIntervals = parts.flatMap(part => {
    const start = offset; offset += part.text.length;
    return part.role === "scope" ? [{ start, end: offset }] : [];
  });
  for (const match of question.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/giu)) {
    let token = match[0];
    const before = question[match.index - 1];
    if (!before || !/[<"'`]/u.test(before)) token = token.replace(/[.,;]+$/u, "");
    while (token.endsWith(")") && (token.match(/\)/gu)?.length ?? 0) > (token.match(/\(/gu)?.length ?? 0)) token = token.slice(0, -1);
    while (token.endsWith("]") && !token.includes("[")) token = token.slice(0, -1);
    if (!before || !/[<"'`]/u.test(before)) token = token.replace(/[.,;]+$/u, "");
    if (!scopeIntervals.some(part => part.start <= match.index && part.end >= match.index + token.length)) return invalid();
  }
  if (subjects.length * dimensions.length + shared.length > MAX_RESEARCH_TARGETS) {
    throw new ResearchPlanningError(question, "needs_refinement");
  }
  if (scope.some(text => !text)) return invalid();
  const target = (subject: string, need: string) => `${subject}: ${need.replace(/[.!?]+$/u, "")}?` +
    (scope.length ? `\n${scope.join(" ")}` : "");
  const claims = subjects.flatMap(subject => dimensions.map(dimension => target(subject, dimension)))
    .concat(shared.map(need => target(subjects.join(" / "), need)));
  if (claims.some(claim => claim.length > 600) || new Set(claims).size !== claims.length) return invalid();
  return claims;
}

/** All entries must be usable. Filtering bad entries would silently lose requested scope. */
export function parseResearchPlan(question: string, output: Record<string, unknown>): string[] {
  if (output.status === "needs_refinement") throw new ResearchPlanningError(question, "needs_refinement");
  if (output.status !== undefined && output.status !== "complete") throw new ResearchPlanningError(question, "invalid_output");
  if (output.constraints !== undefined && (!Array.isArray(output.constraints) || output.constraints.length > 16 ||
    !output.constraints.every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 600))) {
    throw new ResearchPlanningError(question, "invalid_output");
  }
  if (output.comparison !== undefined) {
    // Mixed opaque claims cannot be discarded in favor of a plausible structure.
    if (output.status !== "complete" ||
      (output.claims !== undefined && (!Array.isArray(output.claims) || output.claims.length !== 0))) {
      throw new ResearchPlanningError(question, Array.isArray(output.claims) && output.claims.length > MAX_RESEARCH_TARGETS
        ? "expanded_output" : "invalid_output");
    }
    return comparisonResearchPlan(question, output.comparison, (output.constraints ?? []) as string[]);
  }
  if (!Array.isArray(output.claims) || output.claims.length === 0 || output.claims.length > 64 ||
    !output.claims.every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 600)) {
    throw new ResearchPlanningError(question, "invalid_output");
  }
  const unique = [...new Set((output.claims as string[]).map(value => value.trim()))];
  if (unique.length > MAX_RESEARCH_TARGETS) throw new ResearchPlanningError(question, "expanded_output");
  return unique;
}

/** Parsing/length validation is local to this planning call; transport refusals stay distinct. */
export async function boundedResearchPlan(question: string, call: () => Promise<Record<string, unknown>>): Promise<string[]> {
  try {
    return parseResearchPlan(question, await call());
  } catch (error) {
    if (error instanceof ResearchPlanningError) throw error;
    if (error instanceof ReasoningOutputValidationError) throw new ResearchPlanningError(question, "invalid_output", outputTokenLimitFromValidatedError(error));
    throw error;
  }
}

function failureOutputLimitMessage(error: ReasoningOutputValidationError, language: "en" | "vi" = "en"): string {
  const ceiling = outputTokenLimitFromValidatedError(error);
  return ceiling === undefined ? "" : language === "vi"
    ? `Phản hồi model đã chạm giới hạn ${ceiling.toLocaleString("en-US")} tokens. `
    : `The model response reached its ${ceiling.toLocaleString("en-US")}-token output limit. `;
}

/** Render only for the original caller; suggestions are not copied into accounting or logs. */
export function researchFailureMessage(error: unknown): string {
  const held = researchAdmissionError(error);
  if (held) return held.message;
  if (error instanceof ResearchSelectionError) {
    const limit = failureOutputLimitMessage(error);
    const diagnostic = error.diagnostic;
    const reasons = [...new Set(diagnostic.reasons.map(item => item.code))].join(", ");
    const targetLinks = diagnostic.counts.targetCount > 0
      ? `nonempty integer target links from the existing plan (0–${diagnostic.counts.targetCount - 1})`
      : "a valid target from an existing research plan";
    return `${limit}${error.message}\nDiagnostic: ${diagnostic.id}${reasons ? ` (${reasons})` : ""}\n` +
      `Inspect or save this diagnostic: each read proposal must name an offered source and use ${targetLinks}. ` +
      "Keep the original question, requested source URLs and comparison dimensions. This refusal does not authorize an automatic retry or a completed report.";
  }
  if (!(error instanceof ResearchPlanningError)) return error instanceof Error ? error.message : String(error);
  const limit = failureOutputLimitMessage(error, error.language);
  if (!error.scopeChoices.length) return limit + error.message;
  return limit + error.message + "\n\n" + error.scopeChoices.map((choice, index) => `${index + 1}. ${choice}`).join("\n") +
    (error.language === "vi"
      ? "\n(Các đoạn từ yêu cầu gốc để chọn trọng tâm hẹp hơn; không phải câu hỏi mới hay lần thử tự động.)"
      : "\n(Excerpts from your original request for choosing a narrower focus; not a new question or an automatic retry.)");
}

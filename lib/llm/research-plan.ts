import { MAX_RESEARCH_TARGETS } from "./research-target-limits";
import { researchAdmissionError } from "../research/availability-contract";
import { ReasoningOutputValidationError } from "./reasoning-engine";
import { ResearchSelectionError } from "./research-selection";

export type PlanningRefusalReason = "expanded_output" | "invalid_output" | "needs_refinement";

/** Suggestions are caller-text excerpts, not model-authored targets or executable retries. */
function refinementChoices(question: string): string[] {
  const safe = question.slice(0, 30_000)
    .replace(/https?:\/\/[^\s<>"'`]+/giu, "[source URL in original request]")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, " ");
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

  constructor(question: string, readonly reason: PlanningRefusalReason) {
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
      : " Choose one comparison subject or dimension per question, keeping the original source URLs/versions and qualifications."));
    this.language = vi ? "vi" : "en";
    this.#scopeChoices = Object.freeze(refinementChoices(question));
  }
}

/** All entries must be usable. Filtering bad entries would silently lose requested scope. */
export function parseResearchPlan(question: string, output: Record<string, unknown>): string[] {
  if (output.status === "needs_refinement") throw new ResearchPlanningError(question, "needs_refinement");
  if (output.status !== undefined && output.status !== "complete") throw new ResearchPlanningError(question, "invalid_output");
  if (output.constraints !== undefined && (!Array.isArray(output.constraints) || output.constraints.length > 16 ||
    !output.constraints.every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 600))) {
    throw new ResearchPlanningError(question, "invalid_output");
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
    if (error instanceof ReasoningOutputValidationError) throw new ResearchPlanningError(question, "invalid_output");
    throw error;
  }
}

/** Render only for the original caller; suggestions are not copied into accounting or logs. */
export function researchFailureMessage(error: unknown): string {
  const held = researchAdmissionError(error);
  if (held) return held.message;
  if (error instanceof ResearchSelectionError) {
    const diagnostic = error.diagnostic;
    const reasons = [...new Set(diagnostic.reasons.map(item => item.code))].join(", ");
    return `${error.message}\nDiagnostic: ${diagnostic.id}${reasons ? ` (${reasons})` : ""}`;
  }
  if (!(error instanceof ResearchPlanningError)) return error instanceof Error ? error.message : String(error);
  if (!error.scopeChoices.length) return error.message;
  return error.message + "\n\n" + error.scopeChoices.map((choice, index) => `${index + 1}. ${choice}`).join("\n") +
    (error.language === "vi"
      ? "\n(Các đoạn từ yêu cầu gốc để chọn trọng tâm hẹp hơn; không phải câu hỏi mới hay lần thử tự động.)"
      : "\n(Excerpts from your original request for choosing a narrower focus; not a new question or an automatic retry.)");
}

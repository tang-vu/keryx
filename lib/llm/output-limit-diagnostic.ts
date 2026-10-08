import { z } from "zod";
import { reasoningOutputTokenLimit, type ReasoningAttempt, type ReasoningStep, type SynthesisOutputLimit } from "./reasoning-engine";

export const MAX_OUTPUT_LIMIT_TRACE_STEPS = 2048;

const limit = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const synthesisLimitSchema = z.object({
  stage: z.enum(["generation", "review", "synthesis"]), outputTokenLimit: limit,
});
const diagnosticSchema = synthesisLimitSchema.partial({ stage: true }).extend({
  step: z.enum(["decompose", "decide", "sufficiency", "reevaluate", "synthesize", "attribute"]),
});
export type OutputLimitDiagnostic = z.infer<typeof diagnosticSchema>;

export function parseSynthesisOutputLimit(value: unknown): SynthesisOutputLimit | undefined {
  try { const parsed = synthesisLimitSchema.safeParse(value); return parsed.success ? parsed.data : undefined; }
  catch { return undefined; }
}

export function synthesisOutputLimitFromError(error: unknown, stage: SynthesisOutputLimit["stage"]): SynthesisOutputLimit | undefined {
  const outputTokenLimit = reasoningOutputTokenLimit(error);
  return outputTokenLimit === undefined ? undefined : { stage, outputTokenLimit };
}

/** Safe trace detail retains swallowed review/direct-engine failures without inventing attempts. */
export function collectOutputLimits(attempts: readonly ReasoningAttempt[], trace: unknown): OutputLimitDiagnostic[] {
  const records: OutputLimitDiagnostic[] = [];
  // Current agent traces are bounded by task work. Also bound hostile imported histories.
  for (const step of (Array.isArray(trace) ? trace : []).slice(-MAX_OUTPUT_LIMIT_TRACE_STEPS)) {
    try {
      if (step?.phase !== "synthesize") continue;
      const value = parseSynthesisOutputLimit(step.detail?.reasoningOutputLimit);
      if (value) records.push({ step: "synthesize", ...value });
    } catch { /* Malformed/private detail cannot become a diagnostic. */ }
  }
  for (const attempt of attempts) if (attempt.outputTokenLimit !== undefined)
    records.push({ step: attempt.step, outputTokenLimit: attempt.outputTokenLimit });
  return uniqueOutputLimits(records);
}

function uniqueOutputLimits(recorded: unknown): OutputLimitDiagnostic[] {
  const records = new Map<string, OutputLimitDiagnostic>();
  for (const value of (Array.isArray(recorded) ? recorded : []).slice(0, 2304)) {
    try {
      const parsed = diagnosticSchema.safeParse(value);
      if (!parsed.success || parsed.data.stage && parsed.data.step !== "synthesize") continue;
      const item = parsed.data, key = `${item.step}:${item.stage ?? "unqualified"}:${item.outputTokenLimit}`;
      // Equal ceilings do not prove two records came from the same call. Preserve stage-less
      // attempt observations beside inner subcall diagnostics; collapse only identical kinds.
      records.set(key, item);
    } catch { /* Do not evaluate malformed accessor/proxy metadata. */ }
  }
  return [...records.values()];
}

export function outputLimitText(recorded: unknown, language: "en" | "vi" = "en", traceStepsOmitted?: number): string | null {
  const records = uniqueOutputLimits(recorded);
  const partial = typeof traceStepsOmitted === "number" && Number.isSafeInteger(traceStepsOmitted) && traceStepsOmitted > 0
    ? language === "vi" ? `Lịch sử chẩn đoán output chưa đầy đủ: ${traceStepsOmitted.toLocaleString("en-US")} bước trước đó không được kiểm tra.`
      : `Output-limit history is partial: ${traceStepsOmitted.toLocaleString("en-US")} earlier trace steps were not inspected.` : "";
  if (!records.length) return partial || null;
  const labels: Record<ReasoningStep, [string, string]> = {
    decompose: ["planning", "lập kế hoạch"], decide: ["source selection", "chọn nguồn"],
    sufficiency: ["coverage check", "kiểm tra độ bao phủ"], reevaluate: ["evidence reassessment", "đánh giá lại bằng chứng"],
    synthesize: ["answer preparation", "chuẩn bị câu trả lời"], attribute: ["citation attribution", "phân bổ trích dẫn"],
  };
  const parts = records.slice(0, 8).map(item => {
    const stage = item.stage === "review" ? language === "vi" ? ", kiểm tra bằng chứng" : ", evidence review"
      : item.stage === "generation" ? language === "vi" ? ", sinh câu trả lời" : ", generation" : "";
    return `${labels[item.step][language === "vi" ? 1 : 0]} (${item.outputTokenLimit.toLocaleString("en-US")} tokens${stage})`;
  });
  const limits = parts.join("; ") + (records.length > 8 ? language === "vi"
    ? `; thêm ${records.length - 8} giới hạn khác trong telemetry`
    : `; ${records.length - 8} other limits in telemetry` : "");
  const message = language === "vi"
    ? `Model đã chạm giới hạn output: ${limits}. Xem lại bằng chứng đã lưu; nếu kết quả chưa đủ, hãy thu hẹp câu hỏi trước khi gửi yêu cầu mới.`
    : `Model output limit reached: ${limits}. Review the saved evidence; if the result is incomplete, narrow the question before making a new request.`;
  return message + (partial ? ` ${partial}` : "");
}

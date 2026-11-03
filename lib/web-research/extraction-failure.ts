/** Observed wrapper stage only. No source text, worker output, error message,
 * system path or inferred heap/publisher/root-cause diagnosis may be retained. */
export const extractionFailureReasons = ["input-rejected", "runtime-unavailable", "parser-busy", "worker-binding",
  "worker-start", "worker-io", "deadline", "output-limit", "worker-exit", "invalid-output"] as const;
export interface ExtractionDiagnostic { format: "html" | "pdf"; reason: typeof extractionFailureReasons[number] }
const failures = new WeakMap<object, ExtractionDiagnostic>();

export function safeExtractionDiagnostic(value: unknown): ExtractionDiagnostic | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(fields).some(key => !["format", "reason"].includes(key)) ||
        Object.values(fields).some(field => !("value" in field))) return;
    const format = fields.format?.value, reason = fields.reason?.value;
    if (!["html", "pdf"].includes(format) || !extractionFailureReasons.includes(reason)) return;
    return { format, reason };
  } catch { return undefined; }
}

/** Retain exception identity/name/message and serialize no new exception fields. */
export function rememberExtractionFailure(error: unknown, value: ExtractionDiagnostic): void {
  const diagnostic = safeExtractionDiagnostic(value);
  if (diagnostic && error !== null && (typeof error === "object" || typeof error === "function")) failures.set(error, diagnostic);
}

/** A matching message, JSON property or restored object cannot mint observation. */
export function extractionFailure(error: unknown): ExtractionDiagnostic | undefined {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) return;
  return safeExtractionDiagnostic(failures.get(error));
}

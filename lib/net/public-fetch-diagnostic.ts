/** Fixed, content-free transport facts. Never retain an error message, address or URL. */
export const publicFetchReasons = ["invalid-url", "blocked-address", "dns-unavailable", "tls-unavailable",
  "connection-unavailable", "timeout", "cancelled", "http-status", "redirect-unavailable", "redirect-limit",
  "unsupported-content-type", "partial-response", "byte-limit", "body-unavailable", "transport-unavailable"] as const;
export type PublicFetchReason = typeof publicFetchReasons[number];
export interface PublicFetchDiagnostic { reason: PublicFetchReason; elapsedMs: number; httpStatus?: number }

const failures = new WeakMap<object, PublicFetchDiagnostic>();

export function safePublicFetchDiagnostic(value: unknown): PublicFetchDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(fields).some(key => !["reason", "elapsedMs", "httpStatus"].includes(key)) ||
    Object.values(fields).some(field => !("value" in field))) return;
  const reason = fields.reason?.value, elapsedMs = fields.elapsedMs?.value, httpStatus = fields.httpStatus?.value;
  if (!publicFetchReasons.includes(reason) || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0) return;
  if (httpStatus !== undefined && (reason !== "http-status" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) return;
  return { reason, elapsedMs, ...(httpStatus === undefined ? {} : { httpStatus }) };
}

/** Preserve the original exception's identity/name/message for existing callers. */
export function rememberPublicFetchFailure(error: unknown, value: PublicFetchDiagnostic): void {
  const diagnostic = safePublicFetchDiagnostic(value);
  if (diagnostic && error !== null && (typeof error === "object" || typeof error === "function")) failures.set(error, diagnostic);
}

export function publicFetchFailure(error: unknown): PublicFetchDiagnostic | undefined {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) return;
  return safePublicFetchDiagnostic(failures.get(error));
}

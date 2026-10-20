import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError } from "../llm/reasoning-engine";

/** Error bodies can contain a question, provider response or credential. Read only
 * own data properties; accessors and unrecognized failures supply no diagnosis. */
function ownValue(error: unknown, key: string): unknown {
  if (error === null || typeof error !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function boundedReasoningFailure(error: unknown): string {
  try {
    if (error instanceof ReasoningInputLimitError) return "input_limit (HTTP 413)";
    if (error instanceof ReasoningOutputValidationError) return "output_validation";
    if (error instanceof ReasoningTransportError) {
      const category = ownValue(error, "category");
      return category === "network" || category === "timeout" ? category : "request_failed";
    }
    const status = ownValue(error, "status");
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
      const category = status === 408 ? "timeout" : status === 429 ? "rate_limited"
        : status >= 500 ? "server" : "invalid_request";
      return `${category} (HTTP ${status})`;
    }
    const name = ownValue(error, "name");
    return name === "TimeoutError" || name === "AbortError" ? "timeout" : "request_failed";
  } catch {
    return "request_failed";
  }
}

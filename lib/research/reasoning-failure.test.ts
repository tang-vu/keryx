import { expect, it, vi } from "vitest";
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError } from "../llm/reasoning-engine";
import { boundedReasoningFailure } from "./reasoning-failure";

it.each([
  [new ReasoningInputLimitError("private request"), "input_limit (HTTP 413)"],
  [new ReasoningOutputValidationError("private response"), "output_validation"],
  [new ReasoningTransportError("network"), "network"],
  [new ReasoningTransportError("timeout"), "timeout"],
  [{ status: 408, message: "private" }, "timeout (HTTP 408)"],
  [{ status: 429, body: "private" }, "rate_limited (HTTP 429)"],
  [{ status: 413, response: "private" }, "invalid_request (HTTP 413)"],
  [{ status: 503, cause: "private" }, "server (HTTP 503)"],
  [{ name: "AbortError", message: "private" }, "timeout"],
  [new Error("private post-response application failure"), "request_failed"],
  ["private non-error failure", "request_failed"],
  [{ status: "503" }, "request_failed"],
  [{ status: Infinity }, "request_failed"],
] as const)("retains only a bounded diagnosis for %j", (error, expected) => {
  expect(boundedReasoningFailure(error)).toBe(expected);
});

it("avoids supplier accessors/coercion and contains hostile proxy failures", () => {
  const read = vi.fn(() => { throw new Error("private credential"); });
  const error = Object.defineProperties({}, {
    message: { get: read }, status: { get: read }, name: { get: read }, toString: { value: read },
  });
  expect(boundedReasoningFailure(error)).toBe("request_failed");
  expect(read).not.toHaveBeenCalled();
  const hostile = new Proxy({}, { getPrototypeOf: read, getOwnPropertyDescriptor: read });
  expect(boundedReasoningFailure(hostile)).toBe("request_failed");
});

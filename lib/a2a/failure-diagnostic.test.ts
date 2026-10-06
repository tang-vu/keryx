import { describe, expect, it, vi } from "vitest";
import { a2aFailureDiagnostic, a2aTraceStage, formatA2aFailureDiagnostic } from "./failure-diagnostic";
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError } from "../llm/reasoning-engine";
import { ResearchPlanningError } from "../llm/research-plan";
import { ResearchSelectionError } from "../llm/research-selection";
import { ResearchSelectionInputLimitError, ResearchSelectionPartialBatchError } from "../llm/selection-input";

describe("private A2A failure diagnostics", () => {
  it.each([
    [new ReasoningInputLimitError("PRIVATE_PROMPT_KEY"), "input_limit"],
    [new ResearchSelectionInputLimitError({ promptUtf8Bytes: 32_001, requestedOutputTokens: 1024, maximumCombinedUnits: 40_192 }), "input_limit"],
    [new ResearchPlanningError("PRIVATE_QUESTION https://secret.invalid", "invalid_output"), "planning_refused"],
    // Classification needs only the imported type, never its private diagnostic getter.
    [Object.create(ResearchSelectionError.prototype), "selection_invalid"],
    [new ReasoningOutputValidationError("PRIVATE_PROVIDER_BODY"), "output_invalid"],
    [new ReasoningTransportError("network"), "provider_network"],
    [new ReasoningTransportError("timeout"), "provider_timeout"],
    [Object.assign(new Error("PRIVATE_HTTP_BODY"), { status: 503 }), "unknown"],
    [{ name: "ReasoningInputLimitError", message: "PRIVATE_PROMPT_KEY", category: "timeout" }, "unknown"],
    ["PRIVATE_STRING_EXCEPTION", "unknown"],
    [null, "unknown"],
  ])("classifies only imported typed failures without retaining exception content", (error, category) => {
    const diagnostic = a2aFailureDiagnostic(error, "decide");
    expect(diagnostic).toEqual({ stage: "decide", category });
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE_|secret\.invalid|status|message|name/);
  });

  it("does not inspect exception message, stack, cause, selection diagnostic or HTTP getters", () => {
    const error = Object.create(ResearchSelectionError.prototype);
    const read = vi.fn(() => { throw Error("PRIVATE_GETTER_KEY"); });
    for (const key of ["message", "stack", "cause", "diagnostic", "status"]) Object.defineProperty(error, key, { get: read });
    expect(a2aFailureDiagnostic(error, "decide")).toEqual({ stage: "decide", category: "selection_invalid" });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    [new ReasoningTransportError("network"), "provider_network"],
    [new ReasoningTransportError("timeout"), "provider_timeout"],
    [new ReasoningInputLimitError("PRIVATE_INPUT_PROMPT"), "input_limit"],
    [Object.assign(new Error("PRIVATE_HTTP_BODY"), { status: 408 }), "provider_timeout"],
    [Object.assign(new Error("PRIVATE_HTTP_BODY"), { status: 429 }), "provider_rate_limited"],
    [Object.assign(new Error("PRIVATE_HTTP_BODY"), { status: 503 }), "provider_failure"],
    [Object.assign(new Error("PRIVATE_HTTP_BODY"), { status: 401 }), "invalid_request"],
    [Object.assign(new Error("PRIVATE_HTTP_BODY"), { status: 777 }), "unknown"],
    [new Error("PRIVATE_UNTYPED_NETWORK_FAILURE"), "unknown"],
  ])("projects a typed partial-batch category without copying supplier context", (error, category) => {
    const partial = new ResearchSelectionPartialBatchError(error, 2);
    partial.stack = "PRIVATE_STACK";
    Object.defineProperty(partial, "cause", { get() { throw Error("PRIVATE_CAUSE_KEY"); } });
    const diagnostic = a2aFailureDiagnostic(partial, "decide");
    expect(diagnostic).toEqual({ stage: "decide", category });
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE_|status|completedBatches|cause|stack/);
    expect(formatA2aFailureDiagnostic(diagnostic)).toBe(`stage=decide category=${category}`);
  });

  it("refuses unsupported or getter-only partial categories without evaluating getters", () => {
    const partial = Object.create(ResearchSelectionPartialBatchError.prototype);
    const read = vi.fn(() => { throw Error("PRIVATE_PARTIAL_KEY"); });
    Object.defineProperty(partial, "category", { get: read, configurable: true });
    expect(a2aFailureDiagnostic(partial, "decide")).toEqual({ stage: "decide", category: "unknown" });
    expect(read).not.toHaveBeenCalled();
    Object.defineProperty(partial, "category", { value: "PRIVATE_CATEGORY" });
    expect(a2aFailureDiagnostic(partial, "decide")).toEqual({ stage: "decide", category: "unknown" });
  });

  it("safely contains hostile or revoked proxies", () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw Error("PRIVATE_PROXY_KEY"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const error of [hostile, revoked.proxy]) {
      expect(a2aFailureDiagnostic(error, "fetch")).toEqual({ stage: "fetch", category: "unknown" });
      expect(a2aTraceStage(error)).toBe("unknown");
      expect(formatA2aFailureDiagnostic(error)).toBe("stage=unknown category=unknown");
    }
  });

  it("never invokes untrusted trace getters or formats extra private fields", () => {
    const read = vi.fn(() => { throw Error("PRIVATE_PHASE_KEY"); });
    expect(a2aTraceStage({ get phase() { return read(); }, message: "PRIVATE_PROMPT", detail: { key: "PRIVATE_KEY" } })).toBe("unknown");
    expect(read).not.toHaveBeenCalled();
    expect(a2aTraceStage({ phase: "synthesize", message: "PRIVATE_PROMPT" })).toBe("synthesize");
    expect(a2aTraceStage({ phase: "PRIVATE_STAGE" })).toBe("unknown");
    expect(formatA2aFailureDiagnostic({ stage: "decide", category: "input_limit", message: "PRIVATE_PROVIDER_BODY", stack: "PRIVATE_STACK" }))
      .toBe("stage=decide category=input_limit");
    expect(formatA2aFailureDiagnostic({ stage: "PRIVATE_STAGE", category: "PRIVATE_CATEGORY" }))
      .toBe("stage=unknown category=unknown");
  });
});

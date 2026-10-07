import { afterEach, beforeEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {
  constructor(options: unknown) { sdk.options(options); }
  messages = { create: sdk.create };
} }));
import { AnthropicEngine } from "./anthropic-engine";
import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from "@anthropic-ai/sdk/error";
import { ReasoningOutputLimitError } from "./reasoning-engine";

beforeEach(() => { sdk.create.mockReset(); sdk.options.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

it.each([true, false])("records only complete counters and disables hidden SDK retries: %s", async (complete) => {
  sdk.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: '{"claims":["Synthetic claim"]}' }],
    usage: complete ? { input_tokens: 100, output_tokens: 10 } : { input_tokens: 100 } });
  const engine = new AnthropicEngine();
  expect(await engine.decompose("Synthetic private question")).toEqual(["Synthetic claim"]);
  expect(sdk.options).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  expect(sdk.create).toHaveBeenCalledTimes(1);
  expect(engine.calls).toHaveLength(1);
  expect(engine.calls[0].outcome).toBe("returned");
  expect(engine.usage).toHaveLength(complete ? 1 : 0);
  if (complete) expect(engine.usage[0].callId).toBe(engine.calls[0].id);
  expect(JSON.stringify(engine.calls)).not.toContain("Synthetic private question");
});

it.each([
  [new APIConnectionError({ message: "synthetic private provider body" }), "network"],
  [new APIConnectionTimeoutError({ message: "synthetic private provider body" }), "timeout"],
])("classifies SDK transport failures at their boundary (%s)", async (error, category) => {
  sdk.create.mockRejectedValue(error);
  await expect(new AnthropicEngine().decompose("Synthetic question")).rejects.toMatchObject({ category });
});

it("recognizes the SDK's user-abort wrapper only when Keryx's own deadline has elapsed", async () => {
  const deadline = AbortSignal.abort(new DOMException("synthetic deadline", "TimeoutError"));
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline);
  sdk.create.mockRejectedValue(new APIUserAbortError());
  await expect(new AnthropicEngine().decompose("Synthetic question")).rejects.toMatchObject({ category: "timeout" });
});

it("retains billable usage and a proven output ceiling without inventing an HTTP outage", async () => {
  sdk.create.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: "synthetic private truncated body" }],
    usage: { input_tokens: 100, output_tokens: 2560 } });
  const engine = new AnthropicEngine();
  const failure = await engine.synthesize({ question: "Synthetic question", subClaims: ["Synthetic target"],
    gathered: [{ sourceId: "one", sourceName: "One", marker: "S1", text: "Synthetic source one." },
      { sourceId: "two", sourceName: "Two", marker: "S2", text: "Synthetic source two." }] }).catch(error => error);
  expect(failure).toBeInstanceOf(ReasoningOutputLimitError);
  expect(failure.outputTokenLimit).toBe(2560);
  expect(failure).not.toHaveProperty("status");
  expect(engine.usage[0]).toMatchObject({ inputTokens: 100, outputTokens: 2560, callId: engine.calls[0].id });
  expect(engine.calls[0].outcome).toBe("failed");
  expect(sdk.create).toHaveBeenCalledOnce();
  expect(JSON.stringify(failure)).not.toContain("synthetic private truncated body");
});

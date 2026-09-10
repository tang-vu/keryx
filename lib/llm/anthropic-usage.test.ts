import { beforeEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {
  constructor(options: unknown) { sdk.options(options); }
  messages = { create: sdk.create };
} }));
import { AnthropicEngine } from "./anthropic-engine";

beforeEach(() => { sdk.create.mockReset(); sdk.options.mockClear(); });

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

import { afterEach, describe, expect, it, vi } from "vitest";
import { llmProviderOrder } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("llmProviderOrder", () => {
  it("keeps the historical order when no valid override is present", () => {
    vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "unknown,also-unknown");
    expect(llmProviderOrder()).toEqual(["anthropic", "deepseek", "mimo"]);
  });

  it("deduplicates an explicit ordered allowlist", () => {
    vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", " mimo, deepseek, mimo ");
    expect(llmProviderOrder()).toEqual(["mimo", "deepseek"]);
  });

  it("lets an operator deliberately disable omitted real providers", () => {
    vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "deepseek");
    expect(llmProviderOrder()).toEqual(["deepseek"]);
  });
});

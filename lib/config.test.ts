import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it.each(["", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-chat", "mimo-v2.5", "mimo-v2.5-pro"])("normalizes fresh ordinary configuration %s without reviving a MiMo endpoint", async value => {
  vi.resetModules(); vi.stubEnv("KERYX_LLM_MODEL", value); vi.stubEnv("KERYX_SYNTHESIS_MODEL", value);
  vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-key"); vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "mimo");
  const { config, llmProviderOrder } = await import("./config");
  expect(config.llmModel).toBe("deepseek-flash"); expect(config.synthesisModel).toBe("deepseek-flash");
  expect(llmProviderOrder()).toEqual(["deepseek", "anthropic", "cloudflare"]);
  expect(config).not.toHaveProperty("mimoKey"); expect(config).not.toHaveProperty("mimoBaseUrl");
});
it("preserves an explicitly configured Pro choice without modifying finite original supplier policy", async () => {
  vi.resetModules(); vi.stubEnv("KERYX_LLM_MODEL", "deepseek-v4-pro"); vi.stubEnv("KERYX_SYNTHESIS_MODEL", "deepseek-v4-pro");
  const { config } = await import("./config");
  expect(config.llmModel).toBe("deepseek-v4-pro"); expect(config.synthesisModel).toBe("deepseek-v4-pro");
});

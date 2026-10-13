/**
 * Provider credentials. What must never break: a provider with no key is unreachable rather than
 * reachable-with-an-empty-key, and every catalog provider resolves to somewhere.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "./model-catalog";

async function withEnv(env: Record<string, string | undefined>, run: () => void | Promise<void>) {
  vi.resetModules();
  const prior = { ...process.env };
  Object.assign(process.env, { KERYX_CLOUDFLARE_ENABLED: "false", ANTHROPIC_API_KEY: "",
    KERYX_LLM_PROVIDER_ORDER: "", ...env });
  try {
    await run();
  } finally {
    process.env = prior;
  }
}

afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe("endpointFor", () => {
  it("returns null for a provider with no key — the picker must not offer it", async () => {
    await withEnv({ MIMO_API_KEY: "", DEEPSEEK_API_KEY: "ds-key", OPENAI_API_KEY: "" }, async () => {
      const { endpointFor } = await import("./provider-endpoints");
      expect(endpointFor("mimo" as never)).toBeNull();
      expect(endpointFor("deepseek")?.apiKey).toBe("ds-key");
    });
  });

  it("carries each provider to its own host, not the default one", async () => {
    await withEnv({ MIMO_API_KEY: "mimo-key", DEEPSEEK_API_KEY: "ds-key",
      KERYX_CLOUDFLARE_ENABLED: "true", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "cf-key" }, async () => {
      const { endpointFor } = await import("./provider-endpoints");
      expect(endpointFor("cloudflare")).toEqual({
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1`,
        apiKey: "cf-key",
      });
      expect(endpointFor("deepseek")?.baseUrl).toBe("https://api.deepseek.com");
    });
  });

  it("knows every provider the catalog names", async () => {
    await withEnv({ MIMO_API_KEY: "k", DEEPSEEK_API_KEY: "k", KERYX_CLOUDFLARE_ENABLED: "true", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "k" }, async () => {
      const { endpointFor } = await import("./provider-endpoints");
      for (const m of MODEL_CATALOG) expect(endpointFor(m.provider), m.id).not.toBeNull();
    });
  });
});

describe("availableModels", () => {
  it("offers only the models this box holds a credential for", async () => {
    await withEnv({ MIMO_API_KEY: "", DEEPSEEK_API_KEY: "ds-key", OPENAI_API_KEY: "" }, async () => {
      const { availableModels } = await import("./index");
      const providers = new Set(availableModels().map((m) => m.provider));
      expect(providers).toEqual(new Set(["deepseek"]));
    });
  });

  it("makes no supplier request when MiMo is the only credential", async () => {
    await withEnv(
      { MIMO_API_KEY: "mimo-key", DEEPSEEK_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
      async () => {
        const http = vi.fn(); vi.stubGlobal("fetch", http);
        const { availableModels, resolveModelChoice, getReasoningEngine } = await import("./index");
        expect(availableModels()).toEqual([]);
        expect(resolveModelChoice("mimo-v2.5-pro")).toBeNull();
        const engine = getReasoningEngine();
        expect(engine.name).toBe("heuristic");
        await engine.decompose("Explain source attribution");
        expect(http).not.toHaveBeenCalled();
        // And the ones it cannot serve resolve to null, so the caller runs the default chain.
        expect(resolveModelChoice("deepseek-v4-pro")).toBeNull();
      },
    );
  });

  it("ignores the removed tier in a retained operator order and makes DeepSeek primary", async () => {
    await withEnv({ MIMO_API_KEY: "old-synthetic-key", DEEPSEEK_API_KEY: "ds-key", ANTHROPIC_API_KEY: "anthropic-key",
      KERYX_LLM_PROVIDER_ORDER: "mimo,deepseek,mimo" }, async () => {
      const { llmProviderOrder, llmProvider } = await import("../config");
      expect(llmProviderOrder()).toEqual(["deepseek"]);
      expect(llmProvider()).toBe("deepseek");
    });
    await withEnv({ DEEPSEEK_API_KEY: "ds-key", ANTHROPIC_API_KEY: "anthropic-key" }, async () => {
      const { llmProviderOrder, llmProvider } = await import("../config");
      expect(llmProviderOrder()[0]).toBe("deepseek");
      expect(llmProvider()).toBe("deepseek");
    });
  });
});

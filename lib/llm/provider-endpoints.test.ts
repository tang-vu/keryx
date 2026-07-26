/**
 * Provider credentials. What must never break: a provider with no key is unreachable rather than
 * reachable-with-an-empty-key, and every catalog provider resolves to somewhere.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "./model-catalog";

async function withEnv(env: Record<string, string | undefined>, run: () => void | Promise<void>) {
  vi.resetModules();
  const prior = { ...process.env };
  Object.assign(process.env, env);
  try {
    await run();
  } finally {
    process.env = prior;
  }
}

afterEach(() => vi.resetModules());

describe("endpointFor", () => {
  it("returns null for a provider with no key — the picker must not offer it", async () => {
    await withEnv({ MIMO_API_KEY: "", DEEPSEEK_API_KEY: "ds-key", OPENAI_API_KEY: "" }, async () => {
      const { endpointFor } = await import("./provider-endpoints");
      expect(endpointFor("mimo")).toBeNull();
      expect(endpointFor("deepseek")?.apiKey).toBe("ds-key");
    });
  });

  it("carries each provider to its own host, not the default one", async () => {
    await withEnv({ MIMO_API_KEY: "mimo-key", DEEPSEEK_API_KEY: "ds-key" }, async () => {
      const { endpointFor } = await import("./provider-endpoints");
      expect(endpointFor("mimo")).toEqual({
        baseUrl: "https://api.xiaomimimo.com/v1",
        apiKey: "mimo-key",
      });
      expect(endpointFor("deepseek")?.baseUrl).toBe("https://api.deepseek.com");
    });
  });

  it("knows every provider the catalog names", async () => {
    await withEnv({ MIMO_API_KEY: "k", DEEPSEEK_API_KEY: "k" }, async () => {
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

  it("offers a picker provider's models on a box without the default provider's key", async () => {
    await withEnv(
      { MIMO_API_KEY: "mimo-key", DEEPSEEK_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
      async () => {
        const { availableModels, resolveModelChoice } = await import("./index");
        expect(availableModels().map((m) => m.id)).toEqual(["mimo-v2.5", "mimo-v2.5-pro"]);
        // And the ones it cannot serve resolve to null, so the caller runs the default chain.
        expect(resolveModelChoice("deepseek-v4-pro")).toBeNull();
      },
    );
  });
});

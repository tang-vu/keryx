import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleEngine, type OpenAICompatibleOpts } from "./openai-compatible-engine";

class TransportEngine extends OpenAICompatibleEngine {
  request(model = "deepseek-v4-flash") { return this.chatJson(model, "Return JSON", "test", 2048); }
}
afterEach(() => vi.unstubAllGlobals());

describe("bounded provider JSON requests", () => {
  it.each([
    ["deepseek", "deepseek-v4-flash", true],
    ["deepseek", "deepseek-v4-pro", true],
    ["deepseek", "unknown-future-model", false],
    ["mimo", "mimo-v2.5", false],
    [undefined, "deepseek-v4-flash", false],
  ] as const)("scopes thinking control to %s / %s", async (provider, model, disabled) => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const opts: OpenAICompatibleOpts = { provider, model, name: "test", baseUrl: "https://provider.test", apiKey: "test-only" };
    expect(await new TransportEngine(opts).request()).toEqual({ ok: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe(model);
    expect(body.max_tokens).toBe(2048);
    expect(body.thinking).toEqual(disabled ? { type: "disabled" } : undefined);
  });

  it("still rejects truncated JSON and records its usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ message: { content: '{"ok":' }, finish_reason: "length" }],
      usage: { prompt_tokens: 20, completion_tokens: 2048 },
    })));
    const engine = new TransportEngine({ provider: "deepseek", model: "deepseek-v4-flash", name: "test", baseUrl: "https://provider.test", apiKey: "test-only" });
    await expect(engine.request()).rejects.toMatchObject({ status: 503 });
    expect(engine.usage[0].outputTokens).toBe(2048);
  });
});

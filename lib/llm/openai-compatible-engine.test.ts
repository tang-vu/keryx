import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleEngine, type OpenAICompatibleOpts } from "./openai-compatible-engine";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

class TransportEngine extends OpenAICompatibleEngine {
  request(model = "deepseek-v4-flash") { return this.chatJson(model, "Return JSON", "test", 2048); }
  review() { return this.chatJson("deepseek-v4-flash", "Review JSON", "test", 8192, { reasoningReview: true }); }
  briefSupported() { return this.supportsDecisionBrief(); }
}
afterEach(() => vi.unstubAllGlobals());

describe("bounded provider JSON requests", () => {
  it("enables bounded reasoning only for the separate review and retains ordinary request behavior", async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const engine = new TransportEngine({ provider: "deepseek", name: "test", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKey: "test-only" });
    expect(engine.briefSupported()).toBe(true);
    await engine.review(); await engine.request();
    const bodies = fetchMock.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0]).toMatchObject({ max_tokens: 8192, thinking: { type: "enabled" }, reasoning_effort: "low" });
    expect(bodies[1].thinking).toEqual({ type: "disabled" });
    expect(bodies[1].reasoning_effort).toBeUndefined();
    expect(new TransportEngine({ provider: "mimo", name: "test", baseUrl: "https://provider.test", model: "mimo-v2.5", apiKey: "test-only" }).briefSupported()).toBe(false);
    expect(new TransportEngine({ provider: "deepseek", name: "test", baseUrl: "https://proxy.test", model: "deepseek-v4-flash", apiKey: "test-only" }).briefSupported()).toBe(false);
  });
  it("prohibits redirect delivery under the private transport policy with a real local HTTP server", async () => {
    let redirectedRequests = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.url === "/chat/completions") { response.writeHead(307, { location: "/sink" }); response.end(); }
      else { redirectedRequests++; response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const options = { name: "synthetic", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "synthetic-only" };
      await expect(new TransportEngine({ ...options, redirect: "error" }).request()).rejects.toThrow();
      expect(redirectedRequests).toBe(0);
      // Existing public default remains compatible; private construction explicitly forbids this.
      expect(await new TransportEngine(options).request()).toEqual({ ok: true });
      expect(redirectedRequests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
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

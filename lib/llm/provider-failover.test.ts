/** Fresh runtime failover never resurrects the withdrawn provider or silently upgrades to Pro. */
import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
function configure(secondary = false) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ANTHROPIC_API_KEY: "", DEEPSEEK_API_KEY: "synthetic-deepseek",
    OPENAI_API_KEY: "", MIMO_API_KEY: "synthetic-retired", KERYX_LLM_PROVIDER_ORDER: "", KERYX_LLM_MODEL: "deepseek-flash",
    KERYX_CLOUDFLARE_ENABLED: secondary ? "true" : "false", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "synthetic-cloudflare" })) vi.stubEnv(key, value);
}
describe("credential-aware provider chain", () => {
  it("ignores a retained MiMo-primary order and serves DeepSeek without a MiMo request", async () => {
    configure(); vi.stubEnv("KERYX_LLM_PROVIDER_ORDER", "mimo,deepseek");
    const http = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: '{"claims":["served by DeepSeek"]}' } }] }));
    vi.stubGlobal("fetch", http);
    const { getReasoningEngine } = await import("./index");
    const { effectiveEngineName, reasoningAttempts } = await import("./resilient-engine");
    const engine = getReasoningEngine();
    expect(engine.name).toBe("llm:deepseek:deepseek-flash");
    await expect(engine.decompose("q")).resolves.toEqual(["served by DeepSeek"]);
    expect(effectiveEngineName(engine)).toBe(engine.name);
    expect(reasoningAttempts(engine)).toMatchObject([{ engine: engine.name, tier: 0, outcome: "served" }]);
    expect(http).toHaveBeenCalledOnce(); expect(String(http.mock.calls[0][0])).toBe("https://api.deepseek.com/chat/completions");
  });
  it("serves a failed DeepSeek step from an explicitly enabled secondary before the heuristic", async () => {
    configure(true);
    const http = vi.fn(async (url: string | URL | Request) => String(url).startsWith("https://api.deepseek.com")
      ? new Response("synthetic model refusal", { status: 400 })
      : Response.json({ choices: [{ message: { content: '{"claims":["served by enabled secondary"]}' } }] }));
    vi.stubGlobal("fetch", http);
    const { getReasoningEngine } = await import("./index");
    const { effectiveEngineName, reasoningAttempts } = await import("./resilient-engine");
    const engine = getReasoningEngine();
    await expect(engine.decompose("q")).resolves.toEqual(["served by enabled secondary"]);
    expect(effectiveEngineName(engine)).toContain("llm:cloudflare:");
    expect(reasoningAttempts(engine)).toMatchObject([{ tier: 0, outcome: "failed", status: 400 }, { tier: 1, outcome: "served" }]);
    expect(http).toHaveBeenCalledTimes(2); expect(http.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.deepseek.com/chat/completions", `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1/chat/completions`]);
  });
  it("keeps transient retries bounded on DeepSeek without dispatching MiMo or Pro", async () => {
    configure(); const http = vi.fn<typeof fetch>(async () => new Response("synthetic rate limit", { status: 429 })); vi.stubGlobal("fetch", http);
    const { getReasoningEngine } = await import("./index");
    const { reasoningAttempts } = await import("./resilient-engine");
    const engine = getReasoningEngine(); await expect(engine.decompose("q")).resolves.toEqual(["q"]);
    expect(http).toHaveBeenCalledTimes(3);
    expect(http.mock.calls.every(([url, init]) => String(url) === "https://api.deepseek.com/chat/completions" &&
      JSON.parse(init!.body as string).model === "deepseek-flash")).toBe(true);
    const attempts = reasoningAttempts(engine);
    expect(attempts).toHaveLength(4);
    expect(attempts.slice(0, 3)).toMatchObject([1, 2, 3].map(attempt => ({ engine: "llm:deepseek:deepseek-flash", attempt, outcome: "failed", error: "rate_limited" })));
    expect(attempts[3]).toMatchObject({ engine: "heuristic", attempt: 1, outcome: "served" });
  });
  it("uses the explicit heuristic when only a retired MiMo credential remains", async () => {
    configure(); vi.stubEnv("DEEPSEEK_API_KEY", ""); const http = vi.fn(); vi.stubGlobal("fetch", http);
    const { getReasoningEngine } = await import("./index"); const engine = getReasoningEngine();
    expect(engine.name).toBe("heuristic"); await expect(engine.decompose("q")).resolves.toEqual(["q"]);
    expect(http).not.toHaveBeenCalled();
  });
});

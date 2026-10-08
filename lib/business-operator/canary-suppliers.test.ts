import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatJsonOptions } from "../llm/json-chat-engine";

const guards = vi.hoisted(() => ({ configured: vi.fn(), reserveModel: vi.fn(), ordinary: vi.fn(), legacyConfigured: vi.fn(),
  legacyEngine: vi.fn(), legacyAllowance: vi.fn(), held: 0 }));
vi.mock("./canary-policy", () => ({ configuredBusinessCanary: guards.configured, reserveCanaryModel: guards.reserveModel,
  assertOrdinaryCanarySupplierAdmission: guards.ordinary }));
vi.mock("../llm/bounded-production-engine", () => ({ configuredProductionModelAllowance: guards.legacyConfigured,
  BoundedProductionEngine: guards.legacyEngine, ProductionModelAllowance: guards.legacyAllowance }));

import { BusinessCanaryEngine } from "./canary-suppliers";
import { availableModels, getReasoningEngine } from "../llm";
import { ReasoningInputLimitError, ReasoningOutputValidationError, ReasoningTransportError } from "../llm/reasoning-engine";

class DirectEngine extends BusinessCanaryEngine {
  request(system = "Policy", user = "Data", maxTokens = 2048, options?: ChatJsonOptions) {
    return this.chatJson("another-model-must-not-be-used", system, user, maxTokens, options);
  }
}
const completion = () => Response.json({ choices: [{ message: { content: '{"accepted":true}' }, finish_reason: "stop" }] });
const instruction = " Respond with a single JSON object.";

beforeEach(() => {
  vi.clearAllMocks();
  guards.held = 0;
  guards.configured.mockReturnValue({ format: "synthetic-admitted-canary" });
  guards.legacyConfigured.mockReturnValue(null);
  guards.ordinary.mockImplementation(() => { throw Error("Ordinary supplier transport must not dispatch"); });
  guards.reserveModel.mockImplementation(() => {
    if (guards.held >= 11) throw new Error("Business canary model reservation exhausted");
    guards.held++;
  });
  vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-canary-key");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("finite business canary supplier transport", () => {
  it("reserves before each official HTTP call and blocks the twelfth without any fallback", async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => {
      expect(guards.held).toBe(request.mock.calls.length);
      return completion();
    });
    vi.stubGlobal("fetch", request);
    const engine = new DirectEngine("synthetic-key");
    for (let index = 0; index < 11; index++) await engine.request();
    await expect(engine.request()).rejects.toThrow("reservation exhausted");
    expect([guards.held, request.mock.calls.length]).toEqual([11, 11]);
    expect(guards.ordinary).not.toHaveBeenCalled();
    for (const [url, init] of request.mock.calls) {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer synthetic-key" } });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "deepseek-v4-flash", response_format: { type: "json_object" }, max_tokens: 2048,
        thinking: { type: "disabled" }, messages: [{ role: "system", content: "Policy" + instruction }, { role: "user", content: "Data" }] });
    }
  });

  it("holds a failed request, redacts its body and never retries or follows a redirect", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response("PRIVATE_VENDOR_DETAIL", { status: 500 }))
      .mockResolvedValueOnce(new Response("PRIVATE_REDIRECT_BODY", { status: 302, headers: { Location: "https://unapproved.example" } }));
    vi.stubGlobal("fetch", request);
    const engine = new DirectEngine("synthetic-key");
    await expect(engine.request()).rejects.toMatchObject({ status: 500, message: "Business canary provider request failed (500); reservation retained" });
    expect([guards.held, request.mock.calls.length]).toEqual([1, 1]);
    await expect(engine.request()).rejects.toMatchObject({ status: 302, message: "Business canary provider request failed (302); reservation retained" });
    expect([guards.held, request.mock.calls.length]).toEqual([2, 2]);
    expect(request.mock.calls.every(call => call[1].redirect === "error")).toBe(true);
  });

  it("preserves typed transport and invalid-output categories with no supplier detail", async () => {
    const request = vi.fn().mockRejectedValueOnce(Object.assign(Error("PRIVATE_TIMEOUT"), { name: "TimeoutError" }))
      .mockRejectedValueOnce(Error("PRIVATE_NETWORK"))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"cut":' }, finish_reason: "length" }] }));
    vi.stubGlobal("fetch", request);
    const engine = new DirectEngine("synthetic-key");
    await expect(engine.request()).rejects.toMatchObject({ category: "timeout", message: "Business canary provider request failed (timeout); reservation retained" });
    await expect(engine.request()).rejects.toBeInstanceOf(ReasoningTransportError);
    const outputError = await engine.request().catch(error => error);
    expect(outputError).toBeInstanceOf(ReasoningOutputValidationError);
    expect(outputError.outputTokenLimit).toBe(2048);
    expect(outputError.status).toBeUndefined();
    expect(outputError.message).not.toMatch(/PRIVATE_|cut/);
    expect([guards.held, request.mock.calls.length]).toEqual([3, 3]);
  });

  it("checks complete emitted message UTF-8 and JSON instruction before reservation, without truncation", async () => {
    const request = vi.fn(async (_url: string, _init?: RequestInit) => completion());
    vi.stubGlobal("fetch", request);
    const engine = new DirectEngine("synthetic-key");
    const remaining = 32_000 - Buffer.byteLength("S" + instruction, "utf8");
    const user = "\u00e9".repeat(Math.floor(remaining / 2)) + "a".repeat(remaining % 2);
    await engine.request("S", user, 8192, { reasoningReview: true });
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(Buffer.byteLength(body.messages.map((message: { content: string }) => message.content).join(""), "utf8")).toBe(32_000);
    expect(body.messages[1].content).toBe(user);
    expect(body).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low", max_tokens: 8192 });
    expect(guards.reserveModel).toHaveBeenCalledWith("S", user, 8192);
    await expect(engine.request("S", user + "x", 8192)).rejects.toBeInstanceOf(ReasoningInputLimitError);
    for (const maximum of [0, -1, 1.5, 8193, NaN, Infinity])
      await expect(engine.request("S", "data", maximum)).rejects.toBeInstanceOf(ReasoningInputLimitError);
    expect([guards.held, request.mock.calls.length]).toEqual([1, 1]);
  });

  it("refuses unavailable policy or admission before HTTP", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    const engine = new DirectEngine("synthetic-key");
    guards.configured.mockReturnValue(null);
    await expect(engine.request()).rejects.toThrow("policy is unconfigured");
    guards.configured.mockReturnValue({ format: "synthetic-admitted-canary" });
    guards.reserveModel.mockImplementation(() => { throw new Error("Business canary admitted context required"); });
    await expect(engine.request()).rejects.toThrow("admitted context required");
    expect(request).not.toHaveBeenCalled();
    expect(guards.held).toBe(0);
  });
});

describe("finite canary engine selection", () => {
  it("selects the canary before old allowance and ordinary providers", () => {
    guards.legacyConfigured.mockImplementation(() => { throw new Error("Legacy selector must not run"); });
    expect(getReasoningEngine()).toBeInstanceOf(BusinessCanaryEngine);
    expect(getReasoningEngine("deepseek-flash")).toBeInstanceOf(BusinessCanaryEngine);
    expect(getReasoningEngine("keryx:deepseek-flash")).toBeInstanceOf(BusinessCanaryEngine);
    expect(availableModels().map(model => model.id)).toEqual(["deepseek-flash"]);
    expect(guards.legacyConfigured).not.toHaveBeenCalled();
  });

  it("fails closed for partial configuration, missing credentials and foreign model choices", () => {
    guards.configured.mockImplementationOnce(() => { throw new Error("Business canary selector configuration refused"); });
    expect(() => getReasoningEngine()).toThrow("configuration refused");
    for (const model of ["deepseek-v4-pro", "mimo-v2.5", "cloudflare-llama-3.3", "unknown"])
      expect(() => getReasoningEngine(model)).toThrow("no provider fallback");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => getReasoningEngine()).toThrow("requires its DeepSeek credential");
    expect(guards.legacyConfigured).not.toHaveBeenCalled();
    expect(guards.reserveModel).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { MODEL_CATALOG } from "./model-catalog";
import { createModelEngine } from "./model-engine";

const mutableConfig = config as { deepseekKey: string; mimoKey: string };
const originalKeys = { deepseek: config.deepseekKey, mimo: config.mimoKey };
afterEach(() => { mutableConfig.deepseekKey = originalKeys.deepseek; mutableConfig.mimoKey = originalKeys.mimo; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("shared runtime and watchdog model construction", () => {
  it.each(MODEL_CATALOG)("preserves provider policy and bounded decompose transport for $id", async choice => {
    mutableConfig.deepseekKey = "synthetic-only";
    mutableConfig.mimoKey = "synthetic-only";
    const request = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"claims":["How does settlement work?"]}' }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", request);
    expect(await createModelEngine(choice)!.decompose("test")).toEqual(["How does settlement work?"]);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toBe(`${choice.provider === "deepseek" ? config.llmBaseUrl : config.mimoBaseUrl}/chat/completions`);
    expect(body.model).toBe(choice.model);
    expect(body.max_tokens).toBe(2048);
    expect(body.thinking).toEqual(choice.provider === "deepseek" ? { type: "disabled" } : undefined);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses an uncredentialed probe instead of substituting another provider", () => {
    mutableConfig.deepseekKey = "";
    expect(createModelEngine(MODEL_CATALOG[0])).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import worker, { triggerSourceUpkeep } from "./index";

describe("Free upkeep scheduler", () => {
  it("has no public trigger and makes exactly one fixed request with redirect refusal", async () => {
    const fetcher = vi.fn(async () => new Response("bounded counts"));
    expect((await worker.fetch()).status).toBe(404);
    await triggerSourceUpkeep({ SOURCE_UPKEEP_TOKEN: "a".repeat(43) }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      "https://keryx.cc/api/internal/source-upkeep",
      expect.objectContaining({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) }),
    ]);
  });
  it("does not retry HTTP failure or leaked redirect and never logs a response body", async () => {
    const fetcher = vi.fn(async () => new Response("SECRET DATA", { status: 503 }));
    await expect(triggerSourceUpkeep({ SOURCE_UPKEEP_TOKEN: "a".repeat(43) }, fetcher)).rejects.toThrow("HTTP 503");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const redirect = vi.fn(async () => { throw new TypeError("Redirect refused"); });
    await expect(triggerSourceUpkeep({ SOURCE_UPKEEP_TOKEN: "a".repeat(43) }, redirect)).rejects.toThrow("Redirect refused");
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});

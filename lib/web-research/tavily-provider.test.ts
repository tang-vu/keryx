import { beforeEach, expect, it, vi } from "vitest";
const guards = vi.hoisted(() => ({ canary: vi.fn(), bounded: vi.fn() }));
vi.mock("../business-operator/canary-policy", () => ({ reserveCanarySearch: guards.canary }));
vi.mock("../research/research-allowance", () => ({ reserveBoundedSearch: guards.bounded }));
import { tavilyProvider } from "./tavily-provider";
beforeEach(() => { guards.canary.mockReset(); guards.bounded.mockReset(); });
it("uses fixed bounded basic search, keeps credentials in headers, and ignores vendor answers/raw content", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ answer: "NEVER evidence", results: [
    { title: "Original", url: "https://example.com/a", content: "preview", raw_content: "NEVER read" },
    { title: "private", url: "file:///private", content: "bad" }] })));
  try {
    const rows = await tavilyProvider("synthetic-private-key").search("q".repeat(600));
    expect(rows).toEqual([{ title: "Original", url: "https://example.com/a", snippet: "preview" }]);
    const [url, init] = request.mock.calls[0]; expect(url).toBe("https://api.tavily.com/search");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer synthetic-private-key" } });
    const body = JSON.parse(String(init?.body)); expect(body).toMatchObject({ search_depth: "basic", topic: "general", auto_parameters: false,
      include_answer: false, include_raw_content: false, include_images: false, max_results: 10 });
    expect(body.query.length).toBe(500); expect(String(init?.body)).not.toContain("synthetic-private-key");
  } finally { request.mockRestore(); }
});
it("holds each admitted search before HTTP and blocks the third without retry or depth promotion", async () => {
  let held = 0;
  guards.canary.mockImplementation(() => {
    if (held >= 2) throw Error("Business canary search reservation exhausted");
    held++;
  });
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    expect(held).toBe(request.mock.calls.length);
    return held === 1 ? new Response("PRIVATE_PROVIDER_DETAIL", { status: 429 }) : Response.json({ results: [] });
  });
  try {
    const provider = tavilyProvider("synthetic-key");
    await expect(provider.search("query".repeat(150))).rejects.toThrow("Search provider unavailable");
    expect([held, request.mock.calls.length]).toEqual([1, 1]);
    await expect(provider.search("second query")).resolves.toEqual([]);
    await expect(provider.search("third query")).rejects.toThrow("search reservation exhausted");
    expect([held, request.mock.calls.length]).toEqual([2, 2]);
    expect(guards.bounded).toHaveBeenCalledTimes(2);
    for (const [index, call] of request.mock.calls.entries()) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body.query).toBe(guards.canary.mock.calls[index][0]);
      expect(body).toMatchObject({ search_depth: "basic", auto_parameters: false, include_raw_content: false, include_answer: false });
      expect(call[0]).toBe("https://api.tavily.com/search");
      expect(call[1]?.redirect).toBe("error");
    }
  } finally { request.mockRestore(); }
});

it("refuses invalid canary admission before legacy reservation or HTTP", async () => {
  guards.canary.mockImplementation(() => { throw Error("Business canary admitted context required"); });
  const request = vi.spyOn(globalThis, "fetch");
  try {
    await expect(tavilyProvider("synthetic-key").search("question")).rejects.toThrow("admitted context required");
    expect(guards.bounded).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  } finally { request.mockRestore(); }
});
it("fails closed with redacted errors for quota, bad responses, oversize and caller cancellation", async () => {
  const request = vi.spyOn(globalThis, "fetch");
  try {
    for (const response of [new Response("SECRET", { status: 429 }), new Response("SECRET", { status: 432 }), new Response("bad json"), new Response("x".repeat(250001))]) {
      request.mockResolvedValue(response); await expect(tavilyProvider("SECRET").search("question")).rejects.toThrow("Search provider unavailable");
    }
    const controller = new AbortController(); controller.abort(); request.mockRejectedValue(new Error("SECRET provider body"));
    await expect(tavilyProvider("SECRET").search("private query", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(request.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  } finally { request.mockRestore(); }
});

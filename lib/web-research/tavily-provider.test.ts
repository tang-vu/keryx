import { expect, it, vi } from "vitest";
import { tavilyProvider } from "./tavily-provider";
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

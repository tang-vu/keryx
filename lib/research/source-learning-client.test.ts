import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSourceLearning } from "./source-learning-client";
import { aggregateSourceLearning } from "./source-learning-server";
import { validateSourceLearningReport } from "./source-learning-contract";

const report = aggregateSourceLearning("source-a", "eip155:5042", []);
afterEach(() => vi.unstubAllGlobals());
describe("public source-learning client", () => {
  it("makes one credential-free bounded GET and binds the returned source", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(report)); vi.stubGlobal("fetch", fetcher);
    expect(await fetchSourceLearning("https://keryx.cc", "source-a")).toEqual(report);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://keryx.cc/api/source/source-a/learning", expect.objectContaining({
      method: "GET", cache: "no-store", credentials: "omit", redirect: "error" }));
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
    fetcher.mockImplementation(async () => Response.json({ ...report, sourceId: "another-source" }));
    await expect(fetchSourceLearning("https://keryx.cc", "source-a")).rejects.toThrow();
  });
  it("refuses private/URL selectors and untrusted origins before transport", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const id of ["../private", "https://foreign.test", "source?key=secret", "source\r\nheader"])
      await expect(fetchSourceLearning("https://keryx.cc", id)).rejects.toThrow();
    for (const origin of ["https://keryx.cc/", "https://u:p@keryx.cc", "https://keryx.cc/path", "http://foreign.test"])
      await expect(fetchSourceLearning(origin, "source-a")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects paid, non-JSON and oversized responses without retry or fabricated records", async () => {
    for (const response of [new Response("payment required", { status: 402 }),
      new Response("{}", { headers: { "content-type": "text/html" } }),
      new Response("x".repeat(65537), { headers: { "content-type": "application/json" } })]) {
      const fetcher = vi.fn(async () => response); vi.stubGlobal("fetch", fetcher);
      await expect(fetchSourceLearning("http://127.0.0.1:1234", "source-a")).rejects.toThrow(); expect(fetcher).toHaveBeenCalledOnce();
    }
    const getter = vi.fn(() => "PRIVATE");
    const accessor = Object.defineProperty({ ...report }, "questions", { enumerable: true, get: getter });
    expect(() => validateSourceLearningReport(accessor)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});

import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), agents: [] as Array<{ connect: { lookup: unknown } }> }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({ fetch: mocks.fetch, Agent: class { constructor(options: { connect: { lookup: unknown } }) { mocks.agents.push(options); } async close() {} } }));
import { fetchPublicBytes } from "./public-fetch";
beforeEach(() => { mocks.fetch.mockReset(); mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); mocks.agents.length = 0; });
it("pins each redirect hop and snapshots final URL/type/body", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://second.example/article" } }))
    .mockResolvedValueOnce(new Response("original body", { headers: { "content-type": "text/html; charset=utf8" } }));
  const result = await fetchPublicBytes("https://first.example/a", { httpsOnly: true, allowedContentTypes: ["text/html"] });
  expect(result.finalUrl).toBe("https://second.example/article"); expect(new TextDecoder().decode(result.bytes)).toBe("original body");
  expect(mocks.lookup).toHaveBeenCalledTimes(2); expect(mocks.agents).toHaveLength(2);
  expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual", dispatcher: expect.anything() });
});
it("refuses private and nonHTTPS redirects before opening a second socket", async () => {
  for (const location of ["https://127.0.0.1/private", "https://198.18.0.1/private", "https://[2001:db8::1]/private", "http://second.example/a"]) {
    mocks.fetch.mockReset().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(fetchPublicBytes("https://first.example/a", { httpsOnly: true })).rejects.toThrow(); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  }
});
it("enforces actual body bytes and content type despite untrusted headers", async () => {
  mocks.fetch.mockResolvedValue(new Response("123456", { headers: { "content-type": "text/html", "content-length": "1" } }));
  await expect(fetchPublicBytes("https://first.example/a", { maxBytes: 3 })).rejects.toThrow("too large");
  mocks.fetch.mockResolvedValue(new Response("secret", { headers: { "content-type": "application/octet-stream" } }));
  await expect(fetchPublicBytes("https://first.example/a", { allowedContentTypes: ["text/html"] })).rejects.toThrow("unsupported");
});
it("times out DNS waits and avoids initiating lookups after prior cancellation", async () => {
  mocks.lookup.mockImplementation(() => new Promise(() => {}));
  await expect(fetchPublicBytes("https://slow.example", { timeoutMs: 15 })).rejects.toMatchObject({ name: "AbortError" });
  mocks.lookup.mockReset().mockRejectedValue(new Error("DNS rejected")); const controller = new AbortController(); controller.abort();
  await expect(fetchPublicBytes("https://slow.example", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.lookup).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});

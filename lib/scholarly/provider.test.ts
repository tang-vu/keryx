import { beforeEach, expect, it, vi } from "vitest";
const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("../net/public-fetch", () => ({ fetchPublicDocument: transport }));
beforeEach(() => { vi.resetModules(); transport.mockReset(); });

it("restricts provider endpoints and reuses public-only pinned byte/time/redirect boundaries", async () => {
  const { fetchMetadata } = await import("./provider");
  transport.mockResolvedValue({ text: "{}" });
  await expect(fetchMetadata("https://127.0.0.1/works")).rejects.toThrow();
  await expect(fetchMetadata("https://api.crossref.org@evil.example/works")).rejects.toThrow();
  await expect(fetchMetadata("https://api.crossref.org/works")).resolves.toBe("{}");
  expect(transport).toHaveBeenCalledWith("https://api.crossref.org/works", expect.objectContaining({ maxBytes: 250000, timeoutMs: 6000, maxHops: 0, httpsOnly: true }));
});
it("refuses already-cancelled metadata requests before transport admission", async () => {
  const { fetchMetadata } = await import("./provider"); const controller = new AbortController(); controller.abort();
  await expect(fetchMetadata("https://api.crossref.org/works", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(transport).not.toHaveBeenCalled();
});
it("has one process-wide in-flight slot per vendor and no request queue", async () => {
  const { fetchMetadata } = await import("./provider");
  let release!: (value: { text: string }) => void;
  transport.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const first = fetchMetadata("https://api.crossref.org/works");
  await expect(fetchMetadata("https://api.crossref.org/works/another")).rejects.toThrow("busy");
  expect(transport).toHaveBeenCalledTimes(1); release({ text: "{}" }); await first;
  await expect(fetchMetadata("https://api.crossref.org/works")).rejects.toThrow("cooling");
});
it("paces arXiv for at least three seconds after completion and cools down failures for thirty seconds", async () => {
  vi.useFakeTimers();
  try {
    const { fetchMetadata } = await import("./provider"); transport.mockResolvedValue({ text: "xml" });
    await fetchMetadata("https://export.arxiv.org/api/query");
    await vi.advanceTimersByTimeAsync(2999); await expect(fetchMetadata("https://export.arxiv.org/api/query")).rejects.toThrow("cooling");
    await vi.advanceTimersByTimeAsync(1); await fetchMetadata("https://export.arxiv.org/api/query");
    transport.mockRejectedValue(new Error("429 private response"));
    await expect(fetchMetadata("https://api.crossref.org/works")).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(29999); await expect(fetchMetadata("https://api.crossref.org/works")).rejects.toThrow("cooling");
    expect(transport).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});

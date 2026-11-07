import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), close: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({ fetch: mocks.fetch, Agent: class { async close() { mocks.close(); } } }));
import { fetchPublicBytes } from "./public-fetch";
import { publicFetchFailure } from "./public-fetch-diagnostic";

beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.fetch.mockReset(); mocks.close.mockClear();
});

const partial: Array<{ status: number; headers: Record<string, string> }> = [
  { status: 206, headers: {} },
  { status: 206, headers: { "content-range": "bytes 0-11/100" } },
  { status: 200, headers: { "content-range": "bytes 0-11/100" } },
  { status: 200, headers: { "content-range": "" } },
  { status: 200, headers: { "content-range": "PRIVATE_VENDOR_VALUE" } },
];
it.each(partial)("retains only observed partial scope and the actual bounded body: $status $headers", async ({ status, headers }) => {
  mocks.fetch.mockResolvedValueOnce(new Response(new TextEncoder().encode("received body"), { status, headers }));
  const result = await fetchPublicBytes("https://source.example/document?token=PRIVATE_QUERY");
  expect(result).toMatchObject({ partialResponse: true, contentType: "", finalUrl: "https://source.example/document?token=PRIVATE_QUERY" });
  expect(new TextDecoder().decode(result.bytes)).toBe("received body");
  expect(Object.keys(result).sort()).toEqual(["bytes", "contentType", "finalUrl", "partialResponse"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_VENDOR_VALUE");
  expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
});

it.each([200, 203])("does not infer partial scope from ordinary status %s or Accept-Ranges capability", async status => {
  mocks.fetch.mockResolvedValueOnce(new Response("received body", { status, headers: { "accept-ranges": "bytes" } }));
  const result = await fetchPublicBytes("https://source.example/document");
  expect(result).not.toHaveProperty("partialResponse");
  expect(new TextDecoder().decode(result.bytes)).toBe("received body"); expect(mocks.fetch).toHaveBeenCalledOnce();
});

it.each(partial)("keeps strict whole-document callers refusing partial scope before body reading: $status $headers", async ({ status, headers }) => {
  const response = new Response("received body", { status, headers });
  const reader = vi.spyOn(response.body!, "getReader"), cancel = vi.spyOn(response.body!, "cancel");
  mocks.fetch.mockResolvedValueOnce(response);
  let caught: unknown;
  try { await fetchPublicBytes("https://source.example/document", { requireFullResponse: true }); } catch (error) { caught = error; }
  expect(publicFetchFailure(caught)?.reason).toBe("partial-response");
  expect(reader).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
});

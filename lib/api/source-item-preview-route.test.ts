import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SourceItem } from "../types";
import { sourceItemIdentity } from "../sources/source-item-asset";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), terms: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/registry/source-fetch-payto", () => ({ sourceFetchTerms: mocks.terms }));
import { GET } from "@/app/api/source/[id]/item/[itemId]/preview/route";

const item: SourceItem = { id: "item/one", sourceId: "source-one", title: "Article", link: "https://source.example/one",
  summary: "Free summary", content: "PRIVATE ARTICLE BODY" };
const db = { getSource: vi.fn(), getItem: vi.fn() };
const params = () => ({ params: Promise.resolve({ id: item.sourceId, itemId: item.id }) });
function request(version: string = sourceItemIdentity(item).contentVersion) {
  return new NextRequest(`https://keryx.example/api/source/source-one/item/item%2Fone/preview?version=${encodeURIComponent(version)}`);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(db);
  db.getSource.mockResolvedValue({ id: item.sourceId, active: true, verified: true });
  db.getItem.mockResolvedValue(item);
  mocks.terms.mockResolvedValue({ active: true, payTo: `0x${"1".repeat(40)}`, listPriceUsdc: 0.002 });
});

it("exposes only exact item identity and independently refreshed source terms", async () => {
  const response = await GET(request(), params());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ sourceId: item.sourceId, item: sourceItemIdentity(item),
    payTo: `0x${"1".repeat(40)}`, listPriceMicroUsdc: "2000" });
  expect(text).not.toContain(item.content);
  expect(text).not.toContain(item.summary);
  expect(mocks.terms).toHaveBeenCalledWith(expect.any(Object), { refresh: true });
});

it("refuses stale, missing and duplicate versions before payout lookup", async () => {
  for (const url of [request("sha256:stale"), new NextRequest("https://keryx.example/preview"),
    new NextRequest(`${request().url}&version=${encodeURIComponent(sourceItemIdentity(item).contentVersion)}`)]) {
    expect((await GET(url, params())).status).toBe(409);
  }
  expect(mocks.terms).not.toHaveBeenCalled();
});

it("fails closed on authority outage or inactive source without exposing private failures", async () => {
  mocks.terms.mockRejectedValueOnce(new Error("PRIVATE RPC URL WITH SECRET"));
  const unavailable = await GET(request(), params());
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain("PRIVATE");
  mocks.terms.mockResolvedValueOnce({ active: false });
  expect((await GET(request(), params())).status).toBe(410);
});

it("does not round malformed or unsafe registry prices into authority", async () => {
  for (const price of [0.0000001, Number.MAX_SAFE_INTEGER, NaN, -1]) {
    mocks.terms.mockResolvedValueOnce({ active: true, listPriceUsdc: price });
    expect((await GET(request(), params())).status).toBe(503);
  }
});

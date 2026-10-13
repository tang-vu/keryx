import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
import { GET } from "@/app/api/public-references/route";
import { GET as publisherGET } from "@/app/api/public-references/[id]/items/route";
import { GET as openApiGET } from "@/app/api/openapi.json/route";
const item = { id: "public-item:fixture", referenceId: "public:test", title: "Historical article", summary: "s".repeat(1000), content: "Public body excluded from browse export",
  link: "https://publisher.test/old", deliveryKind: "excerpt", collectionKind: "article", contentVersion: "sha256:fixture", firstCollectedAt: "2026-10-12T00:00:00.000Z", lastCollectedAt: "2026-10-12T00:00:00.000Z" };
beforeEach(() => { mocks.getDb.mockReset(); });
describe("public article browsing API", () => {
  it("publishes both archive endpoints in the composed public OpenAPI without changing existing paths", async () => {
    const body = await openApiGET().json();
    expect(body.paths["/api/public-references"].get.operationId).toBe("browsePublicArticleLibrary");
    expect(body.paths["/api/public-references/{id}/items"].get.operationId).toBe("browsePublisherArticleLibrary");
    expect(body.paths["/api/agent/ask"]).toBeDefined();
  });
  it("exports only bounded public metadata and retains the matching total/cursor", async () => {
    mocks.getDb.mockResolvedValue({ queryPublicReferenceItems: async () => ({ items: [item], total: 1234, nextCursor: "next" }) });
    const response = await GET(new Request("https://keryx.test/api/public-references?query=history"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1234); expect(body.nextCursor).toBe("next");
    expect(body.items[0]).not.toHaveProperty("content"); expect(body.items[0].summary).toHaveLength(600);
  });
  it("refuses invalid limits and publisher IDs before touching storage", async () => {
    for (const params of ["limit=0", "limit=101", "limit=1e2", "limit=", "referenceId=paid:source", "sort=arbitrary", `query=${"x".repeat(501)}`]) {
      expect((await GET(new Request(`https://keryx.test/api/public-references?${params}`))).status).toBe(400);
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("binds publisher routes to their path and isolates unavailable storage", async () => {
    const query = vi.fn(async (_options: unknown) => ({ items: [], total: 0 }));
    mocks.getDb.mockResolvedValue({ queryPublicReferenceItems: query });
    const response = await publisherGET(new Request("https://keryx.test/api/public-references/public:test/items?referenceId=public:other"), { params: Promise.resolve({ id: "public:test" }) });
    expect(response.status).toBe(200); expect(query.mock.calls[0][0]).toMatchObject({ referenceId: "public:test" });
    mocks.getDb.mockRejectedValue(new Error("PRIVATE DATABASE DETAILS"));
    const refused = await GET(new Request("https://keryx.test/api/public-references"));
    expect(refused.status).toBe(503); expect(await refused.text()).not.toContain("PRIVATE DATABASE");
  });
});

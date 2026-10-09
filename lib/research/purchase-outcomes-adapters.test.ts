import { afterEach, describe, expect, it, vi } from "vitest";
import retained from "../../fixtures/purchase-outcomes/retained-testnet.json";
import { projectPurchaseOutcomes } from "./purchase-outcomes-projector";
import { purchaseOutcomesResponse } from "./purchase-outcomes-http";
import { fetchPurchaseOutcomes } from "./purchase-outcomes-client";
import { registerPurchaseOutcomes } from "./purchase-outcomes-mcp";

const report = () => projectPurchaseOutcomes(retained.snapshot, "eip155:5042");
const id = retained.snapshot.id;
afterEach(() => vi.unstubAllGlobals());
describe("public read-only outcome adapters", () => {
  it("returns one bounded public contract and a safe download name with no-store", async () => {
    const read = vi.fn(async () => report());
    const response = await purchaseOutcomesResponse(new Request("https://keryx.cc/?download=1"), id, read);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="keryx-purchase-outcomes-${id}.json"`);
    expect(await response.json()).toEqual(report()); expect(read).toHaveBeenCalledExactlyOnceWith(id);
  });
  it.each(["?network=eip155:5042", "?download=0", "?download=1&download=1", "?owner=private"])("refuses selector %s before storage", async query => {
    const read = vi.fn(); const response = await purchaseOutcomesResponse(new Request(`https://keryx.cc/${query}`), id, read);
    expect(response.status).toBe(400); expect(read).not.toHaveBeenCalled();
  });
  it.each(["../private", "id?token=secret", "id\r\nheader", "", "https://foreign.test"])("refuses unsafe ID %j before storage", async invalid => {
    const read = vi.fn(); expect((await purchaseOutcomesResponse(new Request("https://keryx.cc"), invalid, read)).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("distinguishes missing from unavailable and never echoes private storage failures or wrong records", async () => {
    expect((await purchaseOutcomesResponse(new Request("https://keryx.cc"), id, async () => null)).status).toBe(404);
    for (const read of [async () => { throw new Error("PRIVATE DATABASE CREDENTIAL"); }, async () => ({ ...report(), dispatchId: "other-id" })]) {
      const result = await purchaseOutcomesResponse(new Request("https://keryx.cc"), id, read);
      expect(result.status).toBe(503); expect(await result.text()).toBe('{"error":"Recorded purchase outcomes unavailable"}');
    }
  });
  it("public client makes only credential-free bounded GET and binds the returned ID", async () => {
    const fetcher = vi.fn(async () => Response.json(report())); vi.stubGlobal("fetch", fetcher);
    expect(await fetchPurchaseOutcomes("https://keryx.cc", id)).toEqual(report());
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://keryx.cc/api/dispatch/${id}/purchase-outcomes`);
    expect(options).toMatchObject({ method: "GET", cache: "no-store", credentials: "omit", redirect: "error" });
    expect(options.headers).toBeUndefined(); expect(options.body).toBeUndefined();
    fetcher.mockImplementation(async () => Response.json({ ...report(), dispatchId: "another-run" }));
    await expect(fetchPurchaseOutcomes("https://keryx.cc", id)).rejects.toThrow();
  });
  it.each(["https://keryx.cc/", "http://foreign.test", "https://user:pass@keryx.cc", "https://keryx.cc/path", "https://keryx.cc\u0000"])("refuses untrusted origin %j without fetching", async origin => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(fetchPurchaseOutcomes(origin, id)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses oversized/non-JSON and unavailable responses without any paid retry", async () => {
    for (const response of [new Response("x".repeat(1024 * 1024 + 1), { headers: { "content-type": "application/json" } }),
      new Response("challenge", { status: 402 }), new Response("{}", { headers: { "content-type": "text/html" } })]) {
      const fetcher = vi.fn(async () => response); vi.stubGlobal("fetch", fetcher);
      await expect(fetchPurchaseOutcomes("http://127.0.0.1:1234", id)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("registers the identical public read role and rejects extra private/research selectors before reading", async () => {
    let name: string | undefined, options: unknown, handler: ((value: unknown) => Promise<unknown>) | undefined;
    const read = vi.fn(async () => report());
    registerPurchaseOutcomes({ registerTool(tool, contract, callback) { name = tool; options = contract; handler = callback; } }, read);
    expect(name).toBe("keryx_purchase_outcomes");
    expect(options).toMatchObject({ annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } });
    expect(await handler!({ dispatchId: id })).toEqual({ content: [{ type: "text", text: JSON.stringify(report()) }] });
    read.mockClear();
    expect(await handler!({ dispatchId: id, owner: "private", reviewFirst: true })).toMatchObject({ isError: true });
    expect(read).not.toHaveBeenCalled();
  });
});

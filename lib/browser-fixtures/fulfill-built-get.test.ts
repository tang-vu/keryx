import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { chromium, request, type APIRequestContext, type Browser, type Route } from "playwright";
import { fulfillBuiltGet } from "../../test-support/fulfill-built-get";

let server: Server, origin: string, http: APIRequestContext, browser: Browser;
const text = "<h1>Decoded synthetic navigation</h1>", requests: string[] = [];
beforeAll(async () => {
  server = createServer((req, res) => { requests.push(req.method + " " + req.url); res.writeHead(201, { "content-encoding": "gzip", "content-type": "text/html", "x-fixture": "retained", "cache-control": "no-store" }); res.end(gzipSync(text)); });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done)); const address = server.address(); if (!address || typeof address === "string") throw Error("No loopback address"); origin = `http://127.0.0.1:${address.port}`;
  http = await request.newContext(); browser = await chromium.launch({ headless: true });
}, 30_000);
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await browser?.close(); await http?.dispose(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); expect(requests.every(line => line.startsWith("GET "))).toBe(true); });
async function fixture() {
  const response = await http.get(origin + "/decoded?q=1"), dispose = vi.spyOn(response, "dispose");
  const route = { request: () => ({ url: () => "https://navigation-fixture.test/decoded?q=1", method: () => "GET" }), fetch: vi.fn(async () => response), fulfill: vi.fn< Route["fulfill"] >(async () => {}) };
  return { response, dispose, route };
}
it("retains the decoded response until asynchronous fulfill completes, then disposes it", async () => {
  const f = await fixture(); let complete!: () => void; const gate = new Promise<void>(done => { complete = done; }); f.route.fulfill.mockImplementation(async () => { await gate; });
  const work = fulfillBuiltGet(f.route, origin); await expect.poll(() => f.route.fulfill.mock.calls.length).toBe(1); expect(f.dispose).not.toHaveBeenCalled();
  const options = f.route.fulfill.mock.calls[0][0]!; expect(options.body?.toString()).toBe(text); expect(options.response).toBe(f.response); expect(options.headers).toMatchObject({ "content-type": "text/html", "x-fixture": "retained" });
  for (const name of ["content-encoding", "transfer-encoding", "content-length", "connection", "keep-alive"]) expect(options.headers).not.toHaveProperty(name);
  expect(f.route.fetch).toHaveBeenCalledWith({ url: origin + "/decoded?q=1" }); complete(); await work; expect(f.dispose).toHaveBeenCalledTimes(1);
});
it.each(["body", "headers", "fulfill"])("disposes the fetched response if %s fails", async failure => {
  const f = await fixture(); if (failure === "body") vi.spyOn(f.response, "body").mockRejectedValue(Error("body failed")); else if (failure === "headers") vi.spyOn(f.response, "headers").mockImplementation(() => { throw Error("headers failed"); }); else f.route.fulfill.mockRejectedValue(Error("fulfill failed"));
  await expect(fulfillBuiltGet(f.route, origin)).rejects.toThrow(failure + " failed"); expect(f.dispose).toHaveBeenCalledTimes(1); if (failure !== "fulfill") expect(f.route.fulfill).not.toHaveBeenCalled();
});
it("propagates a fetch failure without attempting fulfillment", async () => { const f = await fixture(); f.route.fetch.mockRejectedValue(Error("fetch failed")); await expect(fulfillBuiltGet(f.route, origin)).rejects.toThrow("fetch failed"); expect(f.dispose).not.toHaveBeenCalled(); expect(f.route.fulfill).not.toHaveBeenCalled(); await f.response.dispose(); });
it("rejects non-GET requests before upstream access", async () => { const f = await fixture(); f.route.request = () => ({ url: () => "https://navigation-fixture.test/", method: () => "POST" }); await expect(fulfillBuiltGet(f.route, origin)).rejects.toThrow(); expect(f.route.fetch).not.toHaveBeenCalled(); await f.response.dispose(); });
it("serves decoded compressed bytes and original status to a real Chromium navigation", async () => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try { await context.route("**/*", route => fulfillBuiltGet(route, origin)); const page = await context.newPage(); const response = await page.goto("https://navigation-fixture.test/decoded?q=browser"); expect(response?.status()).toBe(201); expect(await page.getByRole("heading").textContent()).toBe("Decoded synthetic navigation"); expect(response?.headers()["x-fixture"]).toBe("retained"); } finally { await context.close(); }
});

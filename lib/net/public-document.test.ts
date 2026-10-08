import { beforeEach, expect, it, vi } from "vitest";
import type { LookupFunction } from "node:net";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), agents: [] as Array<{ connect: { lookup: LookupFunction } }> }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({ fetch: mocks.fetch, Agent: class { constructor(options: { connect: { lookup: LookupFunction } }) { mocks.agents.push(options); } async close() {} } }));
import { fetchPublicBytes, fetchPublicUrl } from "./public-fetch";

function pinnedAddresses(index: number) {
  return new Promise((resolve, reject) => {
    mocks.agents[index]!.connect.lookup("rebound.example", { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

beforeEach(() => { mocks.fetch.mockReset(); mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); mocks.agents.length = 0; });

const publicV4 = { address: "93.184.216.34", family: 4 };
const publicV6 = { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 };
const requests = [
  { name: "document", run: (url: string) => fetchPublicBytes(url) },
  { name: "single request", run: (url: string) => fetchPublicUrl(url, { method: "POST", body: "one delivery" }) },
];

it.each(requests)("prefers vetted IPv4 for $name without a second DNS lookup or request", async ({ run }) => {
  mocks.lookup.mockResolvedValueOnce([publicV6, publicV4]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  mocks.fetch.mockImplementation(async () => {
    await expect(pinnedAddresses(0)).resolves.toEqual([publicV4]);
    await expect(pinnedAddresses(0)).resolves.toEqual([publicV4]);
    return new Response("original body");
  });
  await run("https://first.example:8443/article");
  expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith("first.example", { all: true });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][0].href).toBe("https://first.example:8443/article");
});

it.each(requests)("retains IPv6-only DNS and public literal handling for $name", async ({ run }) => {
  mocks.lookup.mockResolvedValue([publicV6]);
  mocks.fetch.mockImplementation(async () => new Response("body"));
  await run("https://first.example/article");
  await expect(pinnedAddresses(0)).resolves.toEqual([publicV6]);
  await run(`https://[${publicV6.address}]/article`);
  await expect(pinnedAddresses(1)).resolves.toEqual([publicV6]);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it.each(requests)("rejects any unsafe DNS answer before choosing a socket for $name", async ({ run }) => {
  for (const unsafe of [
    { address: "10.0.0.1", family: 4 },
    { address: "fd00::1", family: 6 },
    { address: "::ffff:127.0.0.1", family: 6 },
  ]) {
    for (const addresses of [[unsafe, publicV4, publicV6], [publicV4, publicV6, unsafe]]) {
      mocks.lookup.mockResolvedValue(addresses);
      await expect(run("https://first.example/article")).rejects.toThrow("private network");
    }
  }
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.agents).toHaveLength(0);
});

it.each(requests)("does not retry a failed pinned transport for $name", async ({ run }) => {
  mocks.lookup.mockResolvedValue([publicV6, publicV4]);
  mocks.fetch.mockRejectedValue(new Error("connection failed"));
  await expect(run("https://first.example/article")).rejects.toThrow("connection failed");
  await expect(pinnedAddresses(0)).resolves.toEqual([publicV4]);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("pins each redirect hop and snapshots final URL/type/body", async () => {
  mocks.lookup.mockResolvedValueOnce([publicV6, publicV4]).mockResolvedValueOnce([publicV6]);
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://second.example/article" } }))
    .mockResolvedValueOnce(new Response("original body", { headers: { "content-type": "text/html; charset=utf8" } }));
  const result = await fetchPublicBytes("https://first.example/a", { httpsOnly: true, allowedContentTypes: ["text/html"] });
  expect(result.finalUrl).toBe("https://second.example/article"); expect(new TextDecoder().decode(result.bytes)).toBe("original body");
  expect(mocks.lookup).toHaveBeenCalledTimes(2); expect(mocks.agents).toHaveLength(2);
  await expect(pinnedAddresses(0)).resolves.toEqual([publicV4]);
  await expect(pinnedAddresses(1)).resolves.toEqual([publicV6]);
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
it.each([
  { status: 206, headers: {} },
  { status: 200, headers: { "content-range": "bytes 0-9/100" } },
  { status: 200, headers: { "content-range": "" } },
])("refuses known partial membership before reading its body: $status", async ({ status, headers }) => {
  const response = new Response("partial XML", { status, headers: new Headers(Object.entries(headers).filter((pair): pair is [string, string] => typeof pair[1] === "string")) });
  const cancel = vi.spyOn(response.body!, "cancel");
  const read = vi.spyOn(response.body!, "getReader");
  mocks.fetch.mockResolvedValue(response);
  await expect(fetchPublicBytes("https://first.example/feed", { requireFullResponse: true })).rejects.toThrow("partial or ranged");
  expect(cancel).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
it("keeps ordinary partial-body reads compatible and admits a whole 200 response", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response("bounded article", { status: 206 }))
    .mockResolvedValueOnce(new Response("whole feed", { status: 200 }));
  expect(new TextDecoder().decode((await fetchPublicBytes("https://first.example/article")).bytes)).toBe("bounded article");
  expect(new TextDecoder().decode((await fetchPublicBytes("https://first.example/feed", { requireFullResponse: true })).bytes)).toBe("whole feed");
});

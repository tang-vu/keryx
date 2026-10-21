import { afterEach, beforeEach, expect, it, vi } from "vitest";
const authentication = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn() }));
const configuration = vi.hoisted(() => ({ baseUrl: "https://keryx.cc" }));
vi.mock("../auth", () => ({ getSession: authentication.session }));
vi.mock("../api-keys", () => ({ verifyApiKey: authentication.key }));
vi.mock("../config", () => ({ config: configuration }));
import { POST } from "../../app/api/research/evidence-procurement/route";
import { buildEvidenceProcurement } from "./engine";
import { MAX_PROCUREMENT_BYTES } from "./contracts";
import { createEvidenceProcurementRoute } from "./route";
import { exportEvidenceProcurement } from "./export";

const now = Date.parse("2026-10-12T12:00:00.000Z");
const packet = () => ({ version: 1, scope: "private-evidence-procurement", request: {
  id: "adapter-fixture", network: "eip155:5042002", decision: "Which benchmark evidence is missing?",
  budgetMicroUsdc: "50000", expiresAt: "2026-10-13T12:00:00.000Z",
  requirements: [{ id: "latency", question: "What is the measured latency?", priority: 10, status: "missing" }],
}, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] });
const key = `kx_live_${"a".repeat(96)}`, url = "https://keryx.cc/api/research/evidence-procurement";
const request = (headers: Record<string, string> = {}, body: unknown = packet(), target = url) => new Request(target, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, "now").mockReturnValue(now);
  configuration.baseUrl = "https://keryx.cc";
  authentication.session.mockResolvedValue({ address: "0xwallet" }); authentication.key.mockResolvedValue({ scopes: "export" });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("uses the shared result and private response headers for an export-scoped key", async () => {
  const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider calls"));
  const response = await POST(request({ Authorization: `Bearer ${key}` }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ procurement: await buildEvidenceProcurement(packet()) });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(authentication.session).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
});
it("refuses malformed, revoked and ask-only keys before reading private bytes", async () => {
  for (const [authorization, record, status] of [["Bearer bad", { scopes: "export" }, 401],
    [`Bearer ${key}`, null, 401], [`Bearer ${key}`, { scopes: "ask" }, 403]] as const) {
    authentication.key.mockResolvedValue(record);
    const input = request({ Authorization: authorization }), response = await POST(input);
    expect(response.status).toBe(status); expect(input.bodyUsed).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});
it("requires an active session and exact configured origin rather than forwarding headers", async () => {
  expect((await POST(request({ Origin: "https://keryx.cc", "Sec-Fetch-Site": "same-origin" }))).status).toBe(200);
  for (const headers of [{}, { Origin: "https://other.example" }, { Origin: "https://keryx.cc", "Sec-Fetch-Site": "cross-site" }] as Record<string, string>[]) {
    const input = request({ Host: "other.example", "X-Forwarded-Host": "keryx.cc", ...headers });
    expect((await POST(input)).status).toBe(403); expect(input.bodyUsed).toBe(false);
  }
  authentication.session.mockResolvedValue(null);
  const input = request({ Origin: "https://keryx.cc" }); expect((await POST(input)).status).toBe(401); expect(input.bodyUsed).toBe(false);
});
it("denies an authentication outage without reading the packet or exposing diagnostics", async () => {
  const input = request(), response = await createEvidenceProcurementRoute(async () => { throw Error("SECRET_DETAIL"); })(input);
  expect(response.status).toBe(503); expect(input.bodyUsed).toBe(false);
  expect(await response.json()).toEqual({ error: "procurement_authentication_unavailable" });
});
it("contains selectors, MIME, JSON, strict-packet and derived-result errors without private echoes", async () => {
  const handler = createEvidenceProcurementRoute(async () => null);
  for (const input of [request({}, { ...packet(), extra: "SECRET_PACKET" }), request({ "Content-Type": "text/plain" }),
    new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "SECRET_PACKET {" }),
    request({}, await buildEvidenceProcurement(packet()))]) {
    const response = await handler(input); expect(response.status).toBe(400); expect(await response.text()).not.toContain("SECRET_PACKET");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  const selected = request({}, packet(), `${url}?wallet=other`);
  expect((await handler(selected)).status).toBe(400); expect(selected.bodyUsed).toBe(false);
});
it("bounds actual streamed bytes despite a small Content-Length and rejects malformed UTF-8", async () => {
  const handler = createEvidenceProcurementRoute(async () => null);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(MAX_PROCUREMENT_BYTES)); controller.enqueue(new Uint8Array([32])); controller.close();
  } });
  const oversized = new Request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" },
    body: stream, duplex: "half" } as RequestInit);
  expect((await handler(oversized)).status).toBe(400);
  const utf8 = new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: new Uint8Array([0xc3, 0x28]) });
  expect((await handler(utf8)).status).toBe(400);
});
it("holds the five-second read deadline even when body cancellation never settles", async () => {
  vi.useFakeTimers();
  const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  const input = new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  const response = createEvidenceProcurementRoute(async () => null)(input);
  await vi.advanceTimersByTimeAsync(5001);
  expect((await response).status).toBe(400);
});
it.each(["markdown", "csv"])("returns the shared %s attachment under the existing private authorization boundary", async format => {
  const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No transport"));
  const response = await POST(request({ Authorization: `Bearer ${key}` }, packet(), `${url}?format=${format}`));
  const receipt = await exportEvidenceProcurement(packet(), format);
  expect(response.status).toBe(200); expect(await response.text()).toBe(receipt.text);
  expect(response.headers.get("content-type")).toBe(receipt.contentType);
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="private-evidence-procurement-receipt.${receipt.extension}"`);
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(http).not.toHaveBeenCalled();
  authentication.key.mockResolvedValue({ scopes: "ask" });
  const denied = request({ Authorization: `Bearer ${key}` }, packet(), `${url}?format=${format}`);
  expect((await POST(denied)).status).toBe(403); expect(denied.bodyUsed).toBe(false);
  const crossOrigin = request({ Origin: "https://other.example" }, packet(), `${url}?format=${format}`);
  expect((await POST(crossOrigin)).status).toBe(403); expect(crossOrigin.bodyUsed).toBe(false);
});
it("keeps explicit JSON compatible and rejects ambiguous formats before auth or private reads", async () => {
  expect(await (await POST(request({ Origin: "https://keryx.cc" }, packet(), `${url}?format=json`))).json()).toEqual({ procurement: await buildEvidenceProcurement(packet()) });
  const authorize = vi.fn(async () => null), handler = createEvidenceProcurementRoute(authorize);
  for (const query of ["format=", "format=SECRET_FORMAT", "format=csv&format=csv", "format=markdown&wallet=other", "format[]=csv"]) {
    const input = request({}, packet(), `${url}?${query}`), response = await handler(input);
    expect(response.status).toBe(400); expect(input.bodyUsed).toBe(false);
    expect(await response.json()).toEqual({ error: "invalid_evidence_procurement_request" });
  }
  expect(authorize).not.toHaveBeenCalled();
});
it("contains formatted-export errors while JSON can still preserve the original packet", async () => {
  const input = packet(); input.request.decision = "PRIVATE_DETAIL\u0000";
  const response = await POST(request({ Origin: "https://keryx.cc" }, input, `${url}?format=csv`));
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_evidence_procurement" });
  expect((await (await POST(request({ Origin: "https://keryx.cc" }, input))).json()).procurement.packet).toEqual(input);
});

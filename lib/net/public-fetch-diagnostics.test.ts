import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), close: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({ fetch: mocks.fetch, Agent: class { async close() { mocks.close(); } } }));
import { fetchPublicBytes, UnsafeTargetError } from "./public-fetch";
import { publicFetchFailure, rememberPublicFetchFailure, safePublicFetchDiagnostic } from "./public-fetch-diagnostic";

beforeEach(() => { mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); mocks.fetch.mockReset(); mocks.close.mockClear(); });
afterEach(() => vi.useRealTimers());
async function failure(limits = {}) {
  try { await fetchPublicBytes("https://original.example/manual?secret=NEVER_LOG", limits); throw new Error("Expected refusal"); }
  catch (error) { return { error, diagnostic: publicFetchFailure(error) }; }
}

describe("bounded public document diagnostic", () => {
  it.each([403, 429, 503])("retains numeric HTTP %s without vendor headers/body/query or a retry", async status => {
    mocks.fetch.mockResolvedValue(new Response("PRIVATE_VENDOR_BODY", { status, headers: { "x-secret": "PRIVATE_HEADER" } }));
    const { error, diagnostic } = await failure();
    expect(error).toBeInstanceOf(UnsafeTargetError);
    expect(diagnostic).toEqual({ reason: "http-status", httpStatus: status, elapsedMs: expect.any(Number) });
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|NEVER_LOG|original\.example/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["CERT_HAS_EXPIRED", "tls-unavailable"], ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls-unavailable"],
    ["ECONNREFUSED", "connection-unavailable"], ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
    ["UNKNOWN_PRIVATE_CODE", "transport-unavailable"],
  ])("classifies only allowlisted native code %s without exposing the exception", async (code, reason) => {
    const error = new TypeError("PRIVATE_CERT_AND_QUERY", { cause: Object.assign(new Error("PRIVATE_HOST"), { code }) });
    mocks.fetch.mockRejectedValue(error);
    const result = await failure();
    expect(result.error).toBe(error);
    expect(result.diagnostic).toEqual({ reason, elapsedMs: expect.any(Number) });
    expect(JSON.stringify(result.diagnostic)).not.toMatch(/PRIVATE|UNKNOWN|CODE/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("retains DNS failure and rejects every unsafe address before opening a socket", async () => {
    mocks.lookup.mockRejectedValueOnce(new Error("PRIVATE_RESOLVER_ERROR"));
    expect((await failure()).diagnostic?.reason).toBe("dns-unavailable");
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    expect((await failure()).diagnostic?.reason).toBe("blocked-address");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps actual byte/type/partial/redirect limits distinct", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("12345"));
    expect((await failure({ maxBytes: 2 })).diagnostic?.reason).toBe("byte-limit");
    mocks.fetch.mockResolvedValueOnce(new Response("body", { headers: { "content-type": "application/octet-stream" } }));
    expect((await failure({ allowedContentTypes: ["text/html"] })).diagnostic?.reason).toBe("unsupported-content-type");
    mocks.fetch.mockResolvedValueOnce(new Response("partial", { status: 206 }));
    expect((await failure({ requireFullResponse: true })).diagnostic?.reason).toBe("partial-response");
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302 }));
    expect((await failure()).diagnostic?.reason).toBe("redirect-unavailable");
    mocks.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "/again" } }));
    expect((await failure({ maxHops: 0 })).diagnostic?.reason).toBe("redirect-limit");
  });
  it("distinguishes its unchanged deadline from caller cancellation", async () => {
    vi.useFakeTimers(); mocks.lookup.mockImplementation(() => new Promise(() => {}));
    const timed = failure({ timeoutMs: 8000 }); await vi.advanceTimersByTimeAsync(8000);
    const result = await timed; expect(result.error).toMatchObject({ name: "AbortError" });
    expect(result.diagnostic).toEqual({ reason: "timeout", elapsedMs: 8000 });
    const controller = new AbortController(); controller.abort();
    expect((await failure({ signal: controller.signal })).diagnostic?.reason).toBe("cancelled");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

it("does not inspect arbitrary properties or expose extra diagnostic fields", () => {
  const secret = { reason: "http-status", elapsedMs: 1, httpStatus: 403, url: "PRIVATE_QUERY" };
  expect(safePublicFetchDiagnostic(secret)).toBeUndefined();
  expect(safePublicFetchDiagnostic({ reason: "PRIVATE_NATIVE_ERROR", elapsedMs: 1 })).toBeUndefined();
  expect(safePublicFetchDiagnostic({ reason: "http-status", elapsedMs: -1 })).toBeUndefined();
  expect(safePublicFetchDiagnostic({ reason: "tls-unavailable", elapsedMs: 1, httpStatus: 403 })).toBeUndefined();
  const getter = vi.fn(() => "PRIVATE");
  expect(safePublicFetchDiagnostic(Object.defineProperty({}, "reason", { get: getter }))).toBeUndefined();
  expect(getter).not.toHaveBeenCalled();
  const frozen = Object.freeze(new Error("private original")); rememberPublicFetchFailure(frozen, { reason: "timeout", elapsedMs: 8 });
  expect(publicFetchFailure(frozen)).toEqual({ reason: "timeout", elapsedMs: 8 });
});

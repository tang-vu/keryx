import { describe, expect, it, vi } from "vitest";
import { nativeInspectionFixture, OBLIGATION_FIXTURE_OWNER as OWNER } from "../../test-support/operator-obligations";
import { createObligationRoute, type ObligationRouteDependencies } from "./route";
import { configuredObligationReader } from "./reader";

const RAW = `kx_live_${"a".repeat(96)}`;
const request = (headers: Record<string, string> = { authorization: `Bearer ${RAW}` }, query = "") => new Request(`https://inspect.example/api/operator/obligations${query}`, { headers });
function fixture() {
  const deps: ObligationRouteDependencies = { reader: vi.fn(() => ({ wallet: OWNER, role: "public" as const })),
    key: vi.fn(async () => ({ walletAddress: OWNER, scopes: "operator:read" })), inspect: vi.fn(async () => nativeInspectionFixture()) };
  return { deps, get: createObligationRoute(deps) };
}
describe("delegated bearer-only inspection", () => {
  it("requires explicit protected reader AND role; no default/dev/profile activation", () => {
    for (const env of [{}, { KERYX_OPERATOR_OBLIGATION_READER: OWNER }, { KERYX_OPERATOR_OBLIGATION_ROLE: "public" },
      { KERYX_OPERATOR_OBLIGATION_READER: OWNER, KERYX_OPERATOR_OBLIGATION_ROLE: "dev" },
      { KERYX_DEV_WALLETS: OWNER }, { KERYX_OPERATOR_OBLIGATION_READER: `0x${"0".repeat(40)}`, KERYX_OPERATOR_OBLIGATION_ROLE: "public" }]) expect(configuredObligationReader(env)).toBeNull();
    expect(configuredObligationReader({ KERYX_OPERATOR_OBLIGATION_READER: OWNER, KERYX_OPERATOR_OBLIGATION_ROLE: "private" })).toEqual({ wallet: OWNER, role: "private" });
  });
  it.each(["absent-config", "invalid-config", "absent-bearer", "malformed-bearer", "cookie-only", "revoked-key", "outsider", "reader-only", "lookup-error"])("uniformly refuses %s before private hydration", async mode => {
    const { deps } = fixture(); let req = request();
    if (mode === "absent-config") deps.reader = vi.fn(() => null);
    if (mode === "invalid-config") deps.reader = vi.fn(() => { throw new Error("private config detail"); });
    if (mode === "absent-bearer") req = request({});
    if (mode === "malformed-bearer") req = request({ authorization: "Bearer invalid" });
    if (mode === "cookie-only") req = request({ cookie: "keryx_session=anything" });
    if (mode === "revoked-key") deps.key = vi.fn(async () => null);
    if (mode === "outsider") deps.key = vi.fn(async () => ({ walletAddress: `0x${"3".repeat(40)}`, scopes: "operator:read" }));
    if (mode === "reader-only") deps.key = vi.fn(async () => ({ walletAddress: OWNER, scopes: "ask,export,profile:read,history:read" }));
    if (mode === "lookup-error") deps.key = vi.fn(async () => { throw new Error("database private detail"); });
    const response = await createObligationRoute(deps)(req); expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "inspection_unavailable" }); expect(deps.inspect).not.toHaveBeenCalled();
    if (["absent-config", "invalid-config", "absent-bearer", "malformed-bearer", "cookie-only"].includes(mode)) expect(deps.key).not.toHaveBeenCalled();
  });
  it.each(["revoked", "role-changed", "throwing"])("refuses %s reader after async authentication", async mode => {
    const { deps } = fixture(); const initial = { wallet: OWNER, role: "public" as const };
    deps.reader = vi.fn().mockReturnValueOnce(initial).mockImplementation(() => mode === "throwing" ? (() => { throw new Error("secret"); })() : mode === "revoked" ? null : { ...initial, role: "private" });
    const response = await createObligationRoute(deps)(request()); expect(response.status).toBe(401); expect(deps.inspect).not.toHaveBeenCalled();
  });
  it.each(["revoked", "role-changed", "throwing"])("discards private data when reader is %s during inspection", async mode => {
    const { deps } = fixture(); const initial = { wallet: OWNER, role: "public" as const };
    deps.reader = vi.fn().mockReturnValueOnce(initial).mockReturnValueOnce(initial).mockImplementation(() => mode === "throwing" ? (() => { throw new Error("secret"); })() : mode === "revoked" ? null : { ...initial, role: "private" });
    const response = await createObligationRoute(deps)(request()); expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "inspection_unavailable" });
  });
  it("binds the reader separately from custody and serves private no-store unknown data", async () => {
    const { deps, get } = fixture(), response = await get(request()); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.readerWallet).toBe(OWNER); expect(body.projection.scope.custodyWallet).not.toBe(OWNER);
    expect(body.projection.scope.custodyWallet).toBe(body.projection.scope.signer); expect(body.projection.safeNewSpendMicroUsdc).toBe("0");
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Authorization"); expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(deps.key).toHaveBeenCalledWith(RAW); expect(deps.inspect).toHaveBeenCalledOnce();
  });
  it.each(["reader", "role", "custody", "positive", "fixture"])("withholds %s output drift with a bounded error", async mode => {
    const { deps } = fixture(), value = nativeInspectionFixture();
    if (mode === "reader") value.readerWallet = `0x${"3".repeat(40)}`;
    if (mode === "role") value.projection.scope.custodyRole = "private-hosted";
    if (mode === "custody") value.projection.scope.custodyWallet = `0x${"4".repeat(40)}`;
    if (mode === "positive") value.projection.safeNewSpendMicroUsdc = "1";
    if (mode === "fixture") value.projection.source = "offline-fixture";
    deps.inspect = vi.fn(async () => value); const response = await createObligationRoute(deps)(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "inspection_unavailable" });
  });
  it("accepts no caller owner, role, storage or snapshot selectors", async () => {
    const { deps, get } = fixture(); const r = await get(request(undefined, "?owner=other&role=private")); expect(r.status).toBe(400); expect(deps.inspect).not.toHaveBeenCalled();
  });
});

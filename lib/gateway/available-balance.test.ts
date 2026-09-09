import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayAvailableAtomic } from "./available-balance";
import { readGatewayCredit } from "./read-credit";
vi.mock("../config", () => ({ config: { cctpDomain: 26 } }));
import { getGatewayAvailableAtomic } from "./gateway-balance";

const payer = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const row = { depositor: payer, domain: 26, balance: "0.050001" };
const balance = (patch = {}) => ({ token: "USDC", balances: [{ ...row, ...patch }] });
afterEach(() => vi.restoreAllMocks());

describe("Gateway available funds", () => {
  it("binds exact micro-USDC to the requested depositor/domain and distinguishes explicit zero", () => {
    expect(gatewayAvailableAtomic(balance(), payer.toUpperCase().replace("0X", "0x"), 26)).toBe(BigInt(50001));
    expect(gatewayAvailableAtomic(balance({ balance: "0.000000" }), payer, 26)).toBe(BigInt(0));
    expect(gatewayAvailableAtomic(balance({ balance: "12" }), payer, 26)).toBe(BigInt(12000000));
  });
  it.each([{}, { token: "USDC", balances: [] }, { token: "USDC", balances: [row, row] },
    { token: "OTHER", balances: [row] }, balance({ depositor: other }), balance({ domain: 0 }),
    balance({ balance: "0.0000009" }), balance({ balance: "-1" }), balance({ balance: "1e3" }),
    balance({ balance: 1 }), balance({ balance: "9".repeat(72) }), balance({ balance: null }),
  ])("leaves malformed/missing/mismatched funds unknown %#", value => {
    expect(gatewayAvailableAtomic(value, payer, 26)).toBeNull();
  });
  it("browser lookup refuses an outage, mismatched identity and malformed balance", async () => {
    const valid = { status: "known", address: payer, network: "eip155:5042002", available: "50001" };
    const http = vi.spyOn(globalThis, "fetch");
    for (const response of [Response.json({ available: null }, { status: 503 }), Response.json({ ...valid, address: other }),
      Response.json({ ...valid, network: "eip155:1" }), Response.json({ ...valid, available: "0.5" }), Response.json({ available: "0" })]) {
      http.mockResolvedValueOnce(response);
      await expect(readGatewayCredit(payer)).rejects.toThrow();
    }
    http.mockResolvedValueOnce(Response.json({ ...valid, available: "0" }));
    expect(await readGatewayCredit(payer)).toBe(BigInt(0));
    expect(http.mock.calls[0][1]).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
  });
  it("bounds the upstream lookup and preserves missing/error responses as unknown", async () => {
    const http = vi.spyOn(globalThis, "fetch");
    expect(await getGatewayAvailableAtomic("0xgarbage")).toBeNull();
    expect(http).not.toHaveBeenCalled();
    http.mockResolvedValueOnce(Response.json(balance()));
    expect(await getGatewayAvailableAtomic(payer)).toBe(BigInt(50001));
    expect(http.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(JSON.parse(String(http.mock.calls[0][1]?.body))).toEqual({ token: "USDC", sources: [{ depositor: payer, domain: 26 }] });
    for (const response of [Response.json({ balances: [] }), Response.json(balance({ depositor: other })), new Response("down", { status: 500 })]) {
      http.mockResolvedValueOnce(response); expect(await getGatewayAvailableAtomic(payer)).toBeNull();
    }
    http.mockRejectedValueOnce(new Error("timeout")); expect(await getGatewayAvailableAtomic(payer)).toBeNull();
  });
});

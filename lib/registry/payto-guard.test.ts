/**
 * The guard decides who may be paid for a source. Its job is to keep believing the chain
 * when the database disagrees, and to keep believing the last thing the chain said when
 * the RPC node stops answering — while never inventing an answer it never had.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const REGISTRY = "0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536";

const getRegistrySource = vi.fn();
vi.mock("./registry-client", () => ({
  getRegistrySource: (id: string) => getRegistrySource(id),
}));
vi.mock("../config", () => ({ config: { registryReadAddress: REGISTRY } }));

const { allowedPayTo, isAllowed, resetPayToCache } = await import("./payto-guard");

const PAYOUT = "0xBFdD569fde6C02B4Bf245b14d829a80d1CA790c8";
const AUTHOR_A = "0xd6a2755c703E05F78C65441ecAE9Cae2907E9FF8";
const AUTHOR_B = "0x13c817F65c3B8F1F2ca63F38f7E898C9462b6322";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";
const ID = "0x162cd3f7a89f71eb96005c3f8925c14ccdfc5be95c798724615c77c0f18b94bd";

const record = {
  payoutWallet: PAYOUT,
  authors: [
    { wallet: AUTHOR_A, basisPoints: 6000 },
    { wallet: AUTHOR_B, basisPoints: 4000 },
  ],
};

beforeEach(() => {
  resetPayToCache();
  getRegistrySource.mockReset();
});

describe("allowedPayTo", () => {
  it("admits the payout wallet and every author in the on-chain split", async () => {
    getRegistrySource.mockResolvedValue(record);
    const result = await allowedPayTo(ID);

    expect(result.status).toBe("onchain");
    if (result.status !== "onchain") return;
    expect(result.stale).toBe(false);
    expect(result.payoutWallet).toBe(PAYOUT);
    for (const wallet of [PAYOUT, AUTHOR_A, AUTHOR_B]) {
      expect(isAllowed(result.wallets, wallet)).toBe(true);
    }
    expect(isAllowed(result.wallets, ATTACKER)).toBe(false);
  });

  it("matches addresses regardless of checksum casing", async () => {
    getRegistrySource.mockResolvedValue(record);
    const result = await allowedPayTo(ID);
    if (result.status !== "onchain") throw new Error("expected onchain");

    expect(isAllowed(result.wallets, AUTHOR_A.toLowerCase())).toBe(true);
    expect(isAllowed(result.wallets, AUTHOR_A.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("reads the chain once, then serves the cached allowlist", async () => {
    getRegistrySource.mockResolvedValue(record);
    await allowedPayTo(ID);
    await allowedPayTo(ID);
    expect(getRegistrySource).toHaveBeenCalledTimes(1);
  });

  it("reports a source with no registry record as unregistered", async () => {
    getRegistrySource.mockResolvedValue(null);
    expect((await allowedPayTo(ID)).status).toBe("unregistered");
  });

  it("serves the last known allowlist, marked stale, when the chain goes away", async () => {
    getRegistrySource.mockResolvedValueOnce(record);
    await allowedPayTo(ID);

    // Let the 10-minute TTL lapse so the next call must re-read — and fail.
    const realNow = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + 11 * 60_000);
    getRegistrySource.mockRejectedValue(new Error("rpc down"));
    const result = await allowedPayTo(ID);
    clock.mockRestore();

    expect(result.status).toBe("onchain");
    if (result.status !== "onchain") return;
    expect(result.stale).toBe(true);
    expect(isAllowed(result.wallets, AUTHOR_A)).toBe(true);
    expect(isAllowed(result.wallets, ATTACKER)).toBe(false);
  });

  it("refuses to guess when the chain fails and nothing was ever cached", async () => {
    getRegistrySource.mockRejectedValue(new Error("rpc down"));
    const result = await allowedPayTo(ID);

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.error).toContain("rpc down");
  });

  it("says so loudly instead of pretending to check when no registry is configured", async () => {
    // Production ran for weeks with this address unset. An inert guard must never be quiet.
    vi.resetModules();
    vi.doMock("../config", () => ({ config: { registryReadAddress: "" } }));
    vi.doMock("./registry-client", () => ({ getRegistrySource }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const unconfigured = await import("./payto-guard");
    expect((await unconfigured.allowedPayTo(ID)).status).toBe("unregistered");
    expect(getRegistrySource).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("KERYX_REGISTRY_READ_ADDRESS"));

    err.mockRestore();
    vi.doUnmock("../config");
    vi.doUnmock("./registry-client");
    vi.resetModules();
  });
});

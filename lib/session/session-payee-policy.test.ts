/**
 * The worker builds its own payee set rather than being handed one, so this is what an attacker
 * would have to subvert to redirect a payment. It must never widen to an address the registry
 * does not authorise, and never quietly return an empty set (which would authorise nothing, and so
 * be read as "check passed" by a careless caller).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PayToAllowlist } from "../registry/payto-guard";
import { config } from "../config";

const allowedPayTo = vi.fn<(id: string) => Promise<PayToAllowlist>>();
vi.mock("../registry/payto-guard", () => ({ allowedPayTo: (id: string) => allowedPayTo(id) }));

const { authorisedPayees, isAllowedTransactionTarget, resetPayeePolicyCache } = await import(
  "./session-payee-policy"
);

const PAYOUT = "0xBFdD569fde6C02B4Bf245b14d829a80d1CA790c8";
const AUTHOR = "0xd6a2755c703E05F78C65441ecAE9Cae2907E9FF8";
const LEGACY = "0x72cf0d122dcda3fcc44bcab6cfea176c262bc157";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";

function respondWithSources(sources: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ sources }) })),
  );
}

beforeEach(() => {
  resetPayeePolicyCache();
  allowedPayTo.mockReset();
  vi.unstubAllGlobals();
});

describe("authorisedPayees", () => {
  it("unions the on-chain payees of every listed source", async () => {
    respondWithSources([{ walletAddress: PAYOUT, onchainId: "0xabc" }]);
    allowedPayTo.mockResolvedValue({
      status: "onchain",
      wallets: new Set([PAYOUT.toLowerCase(), AUTHOR.toLowerCase()]),
      stale: false,
    });

    const payees = await authorisedPayees();
    expect(payees.has(AUTHOR.toLowerCase())).toBe(true);
    expect(payees.has(ATTACKER.toLowerCase())).toBe(false);
  });

  it("keeps pre-registry sources reachable through their public payout wallet", async () => {
    respondWithSources([{ walletAddress: LEGACY }]);

    const payees = await authorisedPayees();
    expect(payees.has(LEGACY.toLowerCase())).toBe(true);
    expect(allowedPayTo).not.toHaveBeenCalled();
  });

  it("falls back to the listed wallet when the registry cannot be read for one source", async () => {
    respondWithSources([{ walletAddress: PAYOUT, onchainId: "0xabc" }]);
    allowedPayTo.mockResolvedValue({ status: "unavailable", error: "rpc down" });

    const payees = await authorisedPayees();
    expect(payees.has(PAYOUT.toLowerCase())).toBe(true);
    expect(payees.has(ATTACKER.toLowerCase())).toBe(false);
  });

  it("throws rather than authorising nothing when the source index is empty", async () => {
    respondWithSources([]);
    await expect(authorisedPayees()).rejects.toThrow(/no authorised payees/i);
  });

  it("throws when the source index cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(authorisedPayees()).rejects.toThrow(/HTTP 503/);
  });

  it("fetches the index once, then serves the cached set", async () => {
    respondWithSources([{ walletAddress: LEGACY }]);
    await authorisedPayees();
    await authorisedPayees();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("isAllowedTransactionTarget", () => {
  it("admits the USDC contract and the Gateway wallet, whatever the casing", () => {
    expect(isAllowedTransactionTarget(config.usdcAddress)).toBe(true);
    expect(isAllowedTransactionTarget(config.gatewayWallet.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("refuses every other destination, including none at all", () => {
    expect(isAllowedTransactionTarget(ATTACKER)).toBe(false);
    expect(isAllowedTransactionTarget(undefined)).toBe(false);
    expect(isAllowedTransactionTarget("")).toBe(false);
  });
});

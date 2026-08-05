/**
 * The browser signs bearer authorizations, so a payee it accepts is money already gone.
 * These tests pin the two keys that must agree — the source is publicly listed, and the
 * chain authorises the payee for that exact source — and pin the refusals in between.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PayToAllowlist } from "../registry/payto-guard";

const allowedPayTo = vi.fn<(
  id: string,
  options?: { refresh?: boolean },
) => Promise<PayToAllowlist>>();
vi.mock("../registry/payto-guard", () => ({
  allowedPayTo: (id: string, options?: { refresh?: boolean }) => allowedPayTo(id, options),
}));

const {
  buildSourceIndex,
  isPaymentPayeeAllowed,
  resolveAllowedPayTo,
  resolveSourcePaymentAuthority,
} = await import("./client-payto-allowlist");

const SOURCE_WALLET = "0x32ef6F5b656122e4eDd00A43F850286a04400933";
const AUTHOR = "0xd6a2755c703E05F78C65441ecAE9Cae2907E9FF8";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";
const ONCHAIN_ID = "0xff98593c09cc9a84e64a1bb3f73c6e2e1dba0a93319c7ebe59a3889d5625edf0";

const registered = buildSourceIndex([
  { id: "ledger", walletAddress: SOURCE_WALLET, fetchPrice: 0.009, onchainId: ONCHAIN_ID },
]);
const preRegistry = buildSourceIndex([{ id: "conzit", walletAddress: SOURCE_WALLET, fetchPrice: 0.003 }]);

beforeEach(() => allowedPayTo.mockReset());

describe("resolveAllowedPayTo", () => {
  it("returns the wallets the chain authorises for a listed, registered source", async () => {
    allowedPayTo.mockResolvedValue({
      status: "onchain",
      wallets: new Set([SOURCE_WALLET.toLowerCase(), AUTHOR.toLowerCase()]),
      payoutWallet: SOURCE_WALLET,
      creator: SOURCE_WALLET,
      fetchPriceUsdc6: BigInt(2_000),
      active: true,
      stale: false,
    });

    const wallets = await resolveAllowedPayTo("ledger", registered);
    expect(wallets?.has(AUTHOR.toLowerCase())).toBe(true);
    expect(wallets?.has(ATTACKER.toLowerCase())).toBe(false);
  });

  it("refuses a source id the browser never saw in /api/sources", async () => {
    // A compromised API inventing a source id must not be able to name its own payee.
    expect(await resolveAllowedPayTo("not-listed", registered)).toBeNull();
    expect(allowedPayTo).not.toHaveBeenCalled();
  });

  it("refuses when the registry cannot be read, rather than trusting the server", async () => {
    allowedPayTo.mockResolvedValue({ status: "unavailable", error: "rpc down" });
    expect(await resolveAllowedPayTo("ledger", registered)).toBeNull();
  });

  it("falls back to the public payout wallet for sources predating the registry", async () => {
    const wallets = await resolveAllowedPayTo("conzit", preRegistry);
    expect(wallets?.has(SOURCE_WALLET.toLowerCase())).toBe(true);
    expect(wallets?.has(ATTACKER.toLowerCase())).toBe(false);
    expect(allowedPayTo).not.toHaveBeenCalled();
  });

  it("falls back to the payout wallet when the id is set but no record exists on-chain", async () => {
    allowedPayTo.mockResolvedValue({ status: "unregistered" });
    const wallets = await resolveAllowedPayTo("ledger", registered);
    expect(wallets?.has(SOURCE_WALLET.toLowerCase())).toBe(true);
    expect(wallets?.has(ATTACKER.toLowerCase())).toBe(false);
  });
});

describe("resolveSourcePaymentAuthority", () => {
  it("reserves the source payout wallet for fetches while allowing authors only for citations", () => {
    const authority = {
      wallets: new Set([SOURCE_WALLET.toLowerCase(), AUTHOR.toLowerCase()]),
      fetchPayTo: SOURCE_WALLET.toLowerCase(),
      creator: AUTHOR,
      listPriceUsdc: 0.002,
      onchain: true,
      active: true,
    };
    expect(isPaymentPayeeAllowed(authority, SOURCE_WALLET, "fetch")).toBe(true);
    expect(isPaymentPayeeAllowed(authority, AUTHOR, "fetch")).toBe(false);
    expect(isPaymentPayeeAllowed(authority, AUTHOR, "citation")).toBe(true);
  });

  it("refreshes and returns the on-chain creator and price, not mutable index values", async () => {
    allowedPayTo.mockResolvedValue({
      status: "onchain",
      wallets: new Set([SOURCE_WALLET.toLowerCase()]),
      payoutWallet: SOURCE_WALLET,
      creator: AUTHOR,
      fetchPriceUsdc6: BigInt(2_000),
      active: true,
      stale: false,
    });
    await expect(
      resolveSourcePaymentAuthority("ledger", registered, { refresh: true }),
    ).resolves.toMatchObject({
      fetchPayTo: SOURCE_WALLET.toLowerCase(),
      creator: AUTHOR,
      listPriceUsdc: 0.002,
      onchain: true,
    });
    expect(allowedPayTo).toHaveBeenCalledWith(ONCHAIN_ID, { refresh: true });
  });

  it("exposes the documented public-index fallback for pre-registry sources", async () => {
    await expect(resolveSourcePaymentAuthority("conzit", preRegistry)).resolves.toMatchObject({
      fetchPayTo: SOURCE_WALLET.toLowerCase(),
      creator: SOURCE_WALLET,
      listPriceUsdc: 0.003,
      onchain: false,
    });
  });
});

describe("buildSourceIndex", () => {
  it("skips rows with no id or no payout wallet", () => {
    const index = buildSourceIndex([
      { id: "ok", walletAddress: SOURCE_WALLET },
      { id: "no-wallet" },
      { walletAddress: SOURCE_WALLET },
    ]);
    expect([...index.keys()]).toEqual(["ok"]);
  });
});

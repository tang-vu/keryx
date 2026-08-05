import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Source } from "../types";

const mocks = vi.hoisted(() => ({ allowedPayTo: vi.fn() }));
vi.mock("./payto-guard", () => ({ allowedPayTo: mocks.allowedPayTo }));

import { sourceFetchPayTo } from "./source-fetch-payto";

const source: Source = {
  id: "source-1",
  name: "Source",
  url: "https://example.test",
  description: "Publication",
  walletAddress: "0x0000000000000000000000000000000000000001",
  fetchPrice: 0.004,
  tags: [],
  authors: [],
  createdAt: "2026-08-01T00:00:00.000Z",
};

describe("source fetch payout authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the registry payout wallet when an on-chain record exists", async () => {
    const payoutWallet = "0x0000000000000000000000000000000000000002";
    mocks.allowedPayTo.mockResolvedValue({
      status: "onchain",
      payoutWallet,
      wallets: new Set([payoutWallet]),
      stale: false,
    });

    await expect(
      sourceFetchPayTo({ ...source, onchainId: `0x${"ab".repeat(32)}` }),
    ).resolves.toBe(payoutWallet);
  });

  it("uses the documented DB fallback for a pre-registry source", async () => {
    await expect(sourceFetchPayTo(source)).resolves.toBe(source.walletAddress);
    expect(mocks.allowedPayTo).not.toHaveBeenCalled();
  });
});

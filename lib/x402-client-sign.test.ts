import { describe, expect, it, vi } from "vitest";
import type { WalletClient } from "viem";
import {
  signBrowserPaymentAuthorization,
  signPaymentAuthorization,
  type PaymentRequirementsInput,
} from "./x402-client-sign";

const signer = "0x1111111111111111111111111111111111111111";
const requirement: PaymentRequirementsInput = {
  scheme: "exact",
  network: "eip155:5042002",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "2000",
  payTo: "0x2222222222222222222222222222222222222222",
  maxTimeoutSeconds: 691200,
  extra: {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  },
};

function wallet(address = signer) {
  const signTypedData = vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`);
  return {
    client: { account: { address }, signTypedData } as unknown as WalletClient,
    signTypedData,
  };
}

describe("browser x402 signing policy", () => {
  it("signs the pinned testnet domain for the intended session signer", async () => {
    const { client, signTypedData } = wallet();
    await signBrowserPaymentAuthorization(client, requirement, signer, signer);
    expect(signTypedData).toHaveBeenCalledWith(expect.objectContaining({
      domain: {
        name: "GatewayWalletBatched",
        version: "1",
        chainId: 5042002,
        verifyingContract: requirement.extra.verifyingContract,
      },
    }));
  });

  it.each([
    ["missing scheme", { scheme: undefined }],
    ["wrong scheme", { scheme: "upto" }],
    ["missing asset", { asset: undefined }],
    ["wrong asset", { asset: "0x3333333333333333333333333333333333333333" }],
    ["mainnet network", { network: "eip155:5042" }],
    ["parseable network suffix", { network: "eip155:5042002:evil" }],
    ["noncanonical network", { network: "eip155:05042002" }],
    ["short lifetime", { maxTimeoutSeconds: 604800 }],
    ["long lifetime", { maxTimeoutSeconds: 2_592_000 }],
    ["invalid amount", { amount: "2e3" }],
    ["invalid payee", { payTo: "0x12" }],
    ["missing domain name", { extra: { ...requirement.extra, name: undefined } }],
    ["wrong domain version", { extra: { ...requirement.extra, version: "2" } }],
    ["mainnet Gateway", { extra: { ...requirement.extra, verifyingContract: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" } }],
  ])("rejects %s before signing", async (_label, changed) => {
    const { client, signTypedData } = wallet();
    await expect(signBrowserPaymentAuthorization(
      client, { ...requirement, ...changed } as PaymentRequirementsInput, signer, signer,
    )).rejects.toThrow();
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it.each([
    ["different local signer", "0x3333333333333333333333333333333333333333", signer],
    ["different captured grant", signer, "0x3333333333333333333333333333333333333333"],
    ["missing captured grant", signer, ""],
  ])("rejects %s before signing", async (_label, localSigner, capturedSigner) => {
    const { client, signTypedData } = wallet();
    await expect(signBrowserPaymentAuthorization(
      client, requirement, localSigner, capturedSigner,
    )).rejects.toThrow(/session signer/);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("rejects a wallet account outside the matching local and captured grants", async () => {
    const { client, signTypedData } = wallet("0x4444444444444444444444444444444444444444");
    await expect(signBrowserPaymentAuthorization(client, requirement, signer, signer))
      .rejects.toThrow(/session signer/);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("keeps the headless two-argument signer API while applying the pinned domain", async () => {
    const { client, signTypedData } = wallet();
    await signPaymentAuthorization(client, requirement);
    expect(signTypedData).toHaveBeenCalledOnce();
  });
});

/**
 * Drives the real viem call path through a port that structured-clones every message, exactly as
 * `postMessage` does. The worker's own tests hand it tidy objects and so proved nothing about this:
 * viem passes `signTransaction` the whole prepared request, carrying the account, the chain, and a
 * nonce manager — all full of functions — and the clone threw on the first one it met. The Gateway
 * approve failed in the browser while every unit test stayed green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWalletClient, custom, erc20Abi, keccak256, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { config } from "../config";
import type { SignerRequest, SignerResponse } from "./session-signer-protocol";

const payees = vi.fn<() => Promise<ReadonlySet<string>>>();
vi.mock("./session-payee-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-payee-policy")>()),
  authorisedPayees: () => payees(),
}));

vi.mock("./session-key-vault", () => {
  let stored = "";
  return {
    wrapKey: async (privateKeyHex: string) => {
      stored = privateKeyHex;
      return { wrapped: new Uint8Array([1]), iv: new Uint8Array([2]) };
    },
    unwrapKey: async () => stored,
    destroyWrappingKey: async () => { stored = ""; },
  };
});

const { handleSignerRequest } = await import("./session-signer.worker");
const { SessionSigner } = await import("./session-signer-client");

const SIGNATURE = ("0x" + "ab".repeat(65)) as Hex;
const EXPECTED = privateKeyToAccount(keccak256(SIGNATURE));
const CREATOR = "0x32ef6F5b656122e4eDd00A43F850286a04400933";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";
const TX_HASH = ("0x" + "11".repeat(32)) as Hex;

/**
 * An in-process stand-in for the worker port. The point is the `structuredClone` on both legs:
 * anything a real `postMessage` would refuse to carry is refused here too.
 */
function loopbackPort() {
  const listeners: Array<(event: { data: SignerResponse }) => void> = [];
  const deliver = (response: SignerResponse) => {
    const data = structuredClone(response);
    for (const listener of listeners) listener({ data });
  };
  return {
    postMessage(message: unknown) {
      const request = structuredClone(message) as SignerRequest;
      void handleSignerRequest(request)
        .then((result) => deliver({ id: request.id, ok: true, result }))
        .catch((err: unknown) =>
          deliver({ id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
    },
    addEventListener(type: string, listener: (event: never) => void) {
      if (type === "message") listeners.push(listener as (event: { data: SignerResponse }) => void);
    },
    terminate() { listeners.length = 0; },
  } as unknown as ConstructorParameters<typeof SessionSigner>[0];
}

/** Answers only what the prepared request needs; anything else is a bug in the test's assumptions. */
const transport = custom({
  request: async ({ method }: { method: string }) => {
    switch (method) {
      case "eth_chainId":
        return "0x4cef52"; // 5042002
      case "eth_sendRawTransaction":
        return TX_HASH;
      default:
        throw new Error(`unexpected RPC call: ${method}`);
    }
  },
});

async function connectedSigner() {
  const signer = new SessionSigner(loopbackPort());
  await signer.deriveFromSignature(SIGNATURE);
  return signer;
}

/** Everything the prepared request needs, so viem never reaches for the network to fill it in. */
const FEES = {
  nonce: 0,
  gas: BigInt(60_000),
  maxFeePerGas: BigInt(1_000_000_000),
  maxPriorityFeePerGas: BigInt(1_000_000),
} as const;

beforeEach(() => {
  payees.mockReset();
  payees.mockResolvedValue(new Set([CREATOR.toLowerCase()]));
});

describe("the worker signs what viem actually hands it", () => {
  it("signs the Gateway approve through writeContract", async () => {
    const signer = await connectedSigner();
    const wallet = createWalletClient({ account: signer.account()!, chain: arcTestnet, transport });

    const hash = await wallet.writeContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.gatewayWallet, BigInt(50_000)],
      chain: arcTestnet,
      account: signer.account()!,
      ...FEES,
    });
    expect(hash).toBe(TX_HASH);
  });

  it("still refuses to move the session balance, through the same path", async () => {
    const signer = await connectedSigner();
    const wallet = createWalletClient({ account: signer.account()!, chain: arcTestnet, transport });

    await expect(
      wallet.sendTransaction({
        account: signer.account()!,
        chain: arcTestnet,
        to: ATTACKER,
        value: parseEther("0.05"),
        ...FEES,
      }),
    ).rejects.toThrow(/will not sign a transaction/i);
  });

  it("refuses a transaction whose from is some other wallet", async () => {
    const signer = await connectedSigner();
    // A prepared request always carries `from`; a mismatch means the page is trying to have this
    // key rubber-stamp someone else's transaction.
    await expect(
      signer.account()!.signTransaction({
        from: ATTACKER,
        to: config.usdcAddress,
        chainId: 5042002,
        ...FEES,
      } as never),
    ).rejects.toThrow(/this session key is/i);
  });

  it("signs an x402 payment authorization through signTypedData", async () => {
    const signer = await connectedSigner();
    const wallet = createWalletClient({ account: signer.account()!, chain: arcTestnet, transport });

    const signature = await wallet.signTypedData({
      account: signer.account()!,
      domain: {
        name: "GatewayWalletBatched",
        version: "1",
        chainId: 5042002,
        verifyingContract: config.gatewayWallet,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: EXPECTED.address,
        to: CREATOR,
        value: BigInt(4000),
        validAfter: BigInt(0),
        validBefore: BigInt(2_147_483_647),
        nonce: ("0x" + "11".repeat(32)) as Hex,
      },
    });
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("refuses an unauthorised payee through signTypedData", async () => {
    const signer = await connectedSigner();
    const wallet = createWalletClient({ account: signer.account()!, chain: arcTestnet, transport });

    await expect(
      wallet.signTypedData({
        account: signer.account()!,
        domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: config.gatewayWallet },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: EXPECTED.address,
          to: ATTACKER,
          value: BigInt(4000),
          validAfter: BigInt(0),
          validBefore: BigInt(2_147_483_647),
          nonce: ("0x" + "11".repeat(32)) as Hex,
        },
      }),
    ).rejects.toThrow(/not an authorised payee/i);
  });
});

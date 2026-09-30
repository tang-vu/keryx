/**
 * The worker is the only thing standing between injected script and the user's funded session.
 * These tests exercise its refusals directly: they are the reason the key can live behind it.
 *
 * The vault is stubbed (IndexedDB is a browser API); its round-trip is verified in the browser.
 * The payee policy's network side is stubbed too — its own tests cover how the set gets built.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { keccak256, recoverTypedDataAddress, encodeFunctionData, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { SESSION_DEPOSIT_ABI } from "./session-signing-policy";
import type { SignerRequest, SignerRequestBody } from "./session-signer-protocol";

const payees = vi.fn<() => Promise<ReadonlySet<string>>>();

vi.mock("./session-payee-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-payee-policy")>()),
  authorisedPayees: () => payees(),
}));

// In-memory stand-in for the AES-GCM vault: enough to prove derive → wrap → restore round-trips.
vi.mock("./session-key-vault", () => {
  let stored = "";
  return {
    wrapKey: async (privateKeyHex: string) => {
      stored = privateKeyHex;
      return { wrapped: new Uint8Array([1, 2, 3]), iv: new Uint8Array([4, 5, 6]) };
    },
    unwrapKey: async () => stored,
    destroyWrappingKey: async () => { stored = ""; },
  };
});

const { handleSignerRequest } = await import("./session-signer.worker");

const SIGNATURE = ("0x" + "ab".repeat(65)) as Hex;
const EXPECTED = privateKeyToAccount(keccak256(SIGNATURE));

const CREATOR = "0x32ef6F5b656122e4eDd00A43F850286a04400933";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";

const DOMAIN = {
  name: "GatewayWalletBatched",
  version: "1",
  chainId: 5042002,
  verifyingContract: config.gatewayWallet,
};
const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function paymentTo(to: string) {
  return {
    domain: DOMAIN as Record<string, unknown>,
    types: TYPES as unknown as Record<string, ReadonlyArray<{ name: string; type: string }>>,
    primaryType: "TransferWithAuthorization",
    message: {
      from: EXPECTED.address,
      to,
      value: BigInt(4000),
      validAfter: BigInt(Math.floor(Date.now() / 1000) - 600),
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 691200),
      nonce: ("0x" + "11".repeat(32)) as Hex,
    } as Record<string, unknown>,
  };
}

let next = 0;
const send = (request: SignerRequestBody) =>
  handleSignerRequest({ ...request, id: ++next } as SignerRequest);

beforeEach(async () => {
  payees.mockReset();
  payees.mockResolvedValue(new Set([CREATOR.toLowerCase()]));
  await send({ type: "deriveFromSignature", signature: SIGNATURE });
});

describe("key custody", () => {
  it("derives the session address from the wallet signature and never returns the key", async () => {
    const result = (await send({ type: "deriveFromSignature", signature: SIGNATURE })) as Record<string, unknown>;

    expect(result.address).toBe(EXPECTED.address);
    expect(JSON.stringify(result)).not.toContain(keccak256(SIGNATURE));
    expect(Object.keys(result).sort()).toEqual(["address", "iv", "wrapped"]);
  });

  it("rehydrates the same address from wrapped ciphertext", async () => {
    const derived = (await send({ type: "deriveFromSignature", signature: SIGNATURE })) as {
      wrapped: Uint8Array;
      iv: Uint8Array;
    };
    await send({ type: "clear" });

    // A reload: the tab hands back its ciphertext and the worker comes up holding the same key.
    // (The stub forgets on clear, so re-derive first — the real vault survives until revoke.)
    await send({ type: "deriveFromSignature", signature: SIGNATURE });
    const restored = (await send({ type: "restore", wrapped: derived.wrapped, iv: derived.iv })) as {
      address: string;
    };
    expect(restored.address).toBe(EXPECTED.address);
  });

  it("refuses to sign once the key is cleared", async () => {
    await send({ type: "clear" });
    await expect(send(paymentRequest(CREATOR))).rejects.toThrow(/no session key loaded/i);
  });
});

describe("payment authorizations", () => {
  it("signs a payment to a payee the registry authorises", async () => {
    const payload = paymentTo(CREATOR);
    const signature = (await send({ type: "signTypedData", payload })) as Hex;

    const signer = await recoverTypedDataAddress({
      domain: payload.domain,
      types: payload.types,
      primaryType: "TransferWithAuthorization",
      message: payload.message,
      signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
    expect(signer).toBe(EXPECTED.address);
  });

  it("refuses a payee no registered source authorises", async () => {
    // This is the whole point: script that owns the page cannot name itself as the payee.
    await expect(send(paymentRequest(ATTACKER))).rejects.toThrow(/not an authorised payee/i);
  });

  it("refuses to sign anything that is not a payment authorization", async () => {
    const payload = paymentTo(CREATOR);
    payload.primaryType = "Permit";
    await expect(send({ type: "signTypedData", payload })).rejects.toThrow(/signs TransferWithAuthorization only/i);
  });

  it("propagates a failure to establish the payee set rather than signing anyway", async () => {
    payees.mockRejectedValue(new Error("source index unreachable"));
    await expect(send(paymentRequest(CREATOR))).rejects.toThrow(/source index unreachable/i);
  });
});

describe("transactions", () => {
  it("signs the approve and the Gateway deposit", async () => {
    for (const to of [config.usdcAddress, config.gatewayWallet]) {
      const signed = await send({ type: "signTransaction", transaction: transactionTo(to) });
      expect(String(signed)).toMatch(/^0x/);
    }
  });

  it("refuses to move the session EOA's balance anywhere else", async () => {
    // Before the deposit lands, the session EOA holds spendable native USDC. A value transfer to
    // an attacker is exactly the transaction an XSS would ask for.
    await expect(send({ type: "signTransaction", transaction: transactionTo(ATTACKER) })).rejects.toThrow(
      /will not sign a transaction/i,
    );
  });

  it("refuses contract creation", async () => {
    await expect(
      send({ type: "signTransaction", transaction: { ...transactionTo(config.usdcAddress), to: undefined } }),
    ).rejects.toThrow(/will not sign a transaction/i);
  });
});

function paymentRequest(to: string) {
  return { type: "signTypedData" as const, payload: paymentTo(to) };
}

function transactionTo(to: string | undefined): Record<string, unknown> {
  return {
    to,
    chainId: 5042002,
    nonce: 0,
    gas: BigInt(21000),
    maxFeePerGas: BigInt(1_000_000_000),
    maxPriorityFeePerGas: BigInt(1_000_000),
    value: BigInt(0),
    data: to?.toLowerCase() === config.gatewayWallet.toLowerCase()
      ? encodeFunctionData({ abi: SESSION_DEPOSIT_ABI, functionName: "deposit", args: [config.usdcAddress, BigInt(50000)] })
      : encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [config.gatewayWallet, BigInt(50000)] }),
    type: "eip1559" as const,
  };
}

describe("hostile transaction mutation never obtains a signature", () => {
  const approve = (spender: `0x${string}`) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, BigInt(50000)] });
  it.each([
    ["transfer selector", { data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ATTACKER, BigInt(50000)] }) }],
    ["attacker spender", { data: approve(ATTACKER) }],
    ["extra calldata", { data: `${approve(config.gatewayWallet)}00` }],
    ["truncated calldata", { data: approve(config.gatewayWallet).slice(0, -2) }],
    ["noncanonical address padding", { data: approve(config.gatewayWallet).replace("095ea7b300", "095ea7b301") }],
    ["native value", { value: BigInt(1) }],
    ["wrong chain", { chainId: 5042 }],
    ["missing chain", { chainId: undefined }],
    ["wrong sender", { from: ATTACKER }],
    ["authorizationList", { authorizationList: [] }],
    ["accessList", { accessList: [] }],
    ["blob type", { type: "eip4844" }],
    ["blobs", { blobs: [] }],
    ["blob fee", { maxFeePerBlobGas: BigInt(1) }],
    ["unknown field", { customSerializer: "evil" }],
    ["unsafe nonce", { nonce: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative gas", { gas: BigInt(-1) }],
    ["mixed fees", { gasPrice: BigInt(1) }],
    ["priority exceeds cap", { maxPriorityFeePerGas: BigInt(2_000_000_000) }],
  ])("rejects %s", async (_label, mutation) => {
    await expect(send({ type: "signTransaction", transaction: { ...transactionTo(config.usdcAddress), ...mutation } })).rejects.toThrow();
  });

  it("refuses a Gateway deposit for a different asset", async () => {
    await expect(send({ type: "signTransaction", transaction: { ...transactionTo(config.gatewayWallet),
      data: encodeFunctionData({ abi: SESSION_DEPOSIT_ABI, functionName: "deposit", args: [ATTACKER, BigInt(50000)] }) } })).rejects.toThrow(/calldata/);
  });
});

describe("typed data authority before payee lookup", () => {
  it.each([
    ["chain", { chainId: 5042 }], ["token domain", { verifyingContract: config.usdcAddress }],
    ["contract", { verifyingContract: ATTACKER }], ["name", { name: "USD Coin" }],
    ["version", { version: "2" }], ["salt", { salt: "0x" + "00".repeat(32) }],
  ])("rejects mutated domain %s", async (_label, domain) => {
    const payload = paymentTo(CREATOR); payload.domain = { ...payload.domain, ...domain };
    await expect(send({ type: "signTypedData", payload })).rejects.toThrow(/domain/);
    expect(payees).not.toHaveBeenCalled();
  });
  it.each([
    ["from", { from: ATTACKER }], ["zero value", { value: BigInt(0) }],
    ["negative", { value: BigInt(-1) }], ["overflow", { value: BigInt(1) << BigInt(256) }],
    ["unsafe number", { value: Number.MAX_SAFE_INTEGER + 1 }], ["fraction", { value: 0.5 }],
    ["nonce", { nonce: "0x11" }], ["future after", { validAfter: BigInt(Math.floor(Date.now() / 1000) + 600) }],
    ["old after", { validAfter: BigInt(0) }], ["unbounded before", { validBefore: BigInt(2 ** 31) }],
    ["expired", { validBefore: BigInt(0) }], ["short life", { validBefore: BigInt(Math.floor(Date.now() / 1000) + 600) }],
    ["extra field", { token: config.usdcAddress }],
  ])("rejects mutated message %s", async (_label, message) => {
    const payload = paymentTo(CREATOR); payload.message = { ...payload.message, ...message };
    await expect(send({ type: "signTypedData", payload })).rejects.toThrow();
    expect(payees).not.toHaveBeenCalled();
  });
  it("rejects changed types, field order, domain types and extra schemas", async () => {
    for (const types of [
      { TransferWithAuthorization: TYPES.TransferWithAuthorization.map(field => field.name === "value" ? { ...field, type: "uint128" } : field) },
      { TransferWithAuthorization: [...TYPES.TransferWithAuthorization].reverse() },
      { ...TYPES, Permit: [] },
      { ...TYPES, EIP712Domain: [{ name: "name", type: "string" }] },
      { TransferWithAuthorization: TYPES.TransferWithAuthorization.map(field => ({ ...field, injected: true })) },
    ]) {
      const payload = paymentTo(CREATOR); payload.types = types;
      await expect(send({ type: "signTypedData", payload })).rejects.toThrow(/types/);
    }
    expect(payees).not.toHaveBeenCalled();
  });
});

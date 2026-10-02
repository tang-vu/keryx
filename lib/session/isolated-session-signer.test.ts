import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, keccak256, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { createIsolatedSessionContext, type IsolatedSessionContextInput } from "./isolated-session-context";
import { createIsolatedSessionSigner } from "./isolated-session-signer";
import { createSessionSigningPolicy } from "./session-signing-policy";
import type { WrappingKeyStore } from "./isolated-session-vault";
import type { TypedDataPayload } from "./session-signer-protocol";

const OWNER = privateKeyToAccount(`0x${"11".repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${"22".repeat(32)}`);
const PAYEE = OTHER.address;
const NOW = 2_000_000_000;
const INPUT: IsolatedSessionContextInput = { profile: ARC_MAINNET_PROFILE, origin: "https://pilot.example.invalid",
  owner: OWNER.address, epoch: "pilot-2026-10", candidateDigest: `0x${"33".repeat(32)}`,
  maxPaymentMicroUsdc: "10000", expiresAtSeconds: NOW + 3600 };

function store(): WrappingKeyStore & { keys: Map<string, CryptoKey> } {
  const keys = new Map<string, CryptoKey>();
  return { keys,
    async getOrCreate(namespace, candidate) { if (!keys.has(namespace)) keys.set(namespace, candidate); return keys.get(namespace)!; },
    async destroy(namespace) { keys.delete(namespace); },
  };
}
function fixture(input: IsolatedSessionContextInput = INPUT, keys = store()) {
  const state = { origin: input.origin, now: NOW };
  const signer = createIsolatedSessionSigner(input, { store: keys, currentOrigin: () => state.origin,
    nowSeconds: () => state.now, authorisedPayees: async () => new Set([PAYEE.toLowerCase()]) });
  return { signer, state, keys };
}
async function derive(f = fixture()) {
  const signature = await OWNER.signMessage({ message: f.signer.context.derivationMessage });
  const blob = await f.signer.derive(signature);
  return { ...f, blob, signature };
}
function payment(from: Hex, input = INPUT): TypedDataPayload {
  return { domain: { name: "GatewayWalletBatched", version: "1", chainId: input.profile.chainId, verifyingContract: input.profile.gatewayWallet },
    primaryType: "TransferWithAuthorization", types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    message: { from, to: PAYEE, value: BigInt(2000), validAfter: BigInt(NOW - 600), validBefore: BigInt(NOW + 691200), nonce: `0x${"44".repeat(32)}` } };
}

describe("isolated dormant session signer", () => {
  it("authenticates the owner message, produces a different key from legacy and signs the pinned mainnet domain", async () => {
    const f = await derive();
    expect(Object.keys(f.blob).sort()).toEqual(["address", "contextDigest", "format", "iv", "wrapped"]);
    expect(f.blob.address).not.toBe(privateKeyToAccount(keccak256(f.signature)).address);
    expect([...f.keys.keys.keys()]).toEqual([f.signer.context.storageNamespace]);
    const payload = payment(f.blob.address);
    const signature = await f.signer.signPayment(payload);
    expect(await recoverTypedDataAddress({ ...payload, signature } as Parameters<typeof recoverTypedDataAddress>[0])).toBe(f.blob.address);
    expect(f.keys.keys.values().next().value!.extractable).toBe(false);
  });

  it("restores real AES-GCM ciphertext in a fresh instance with the same context", async () => {
    const f = await derive();
    const restored = fixture(INPUT, f.keys).signer;
    expect(await restored.restore(structuredClone(f.blob))).toBe(f.blob.address);
    await expect(restored.signPayment(payment(f.blob.address))).resolves.toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("derives disjoint valid session addresses on each network and candidate epoch", async () => {
    const mainnet = await derive();
    const testnet = await derive(fixture({ ...INPUT, profile: ARC_TESTNET_PROFILE }));
    const nextEpoch = await derive(fixture({ ...INPUT, epoch: "pilot-next" }));
    expect(new Set([mainnet.blob.address, testnet.blob.address, nextEpoch.blob.address]).size).toBe(3);
    expect(new Set([mainnet.signer.context.storageNamespace, testnet.signer.context.storageNamespace, nextEpoch.signer.context.storageNamespace]).size).toBe(3);
    await expect(mainnet.signer.signPayment(payment(mainnet.blob.address, { ...INPUT, profile: ARC_TESTNET_PROFILE }))).rejects.toThrow("domain");
  });

  it.each([
    { profile: ARC_TESTNET_PROFILE }, { origin: "https://other.example.invalid" }, { owner: OTHER.address },
    { epoch: "pilot-next" }, { candidateDigest: `0x${"55".repeat(32)}` as Hex },
    { maxPaymentMicroUsdc: "9000" }, { expiresAtSeconds: NOW + 7200 },
  ])("rejects original signature and ciphertext in changed identity %j", async change => {
    const f = await derive();
    const other = fixture({ ...INPUT, ...change }, f.keys).signer;
    await expect(other.derive(f.signature)).rejects.toThrow("owner refused");
    await expect(other.restore(f.blob)).rejects.toThrow("ciphertext context refused");
  });

  it("rejects another wallet, arbitrary derivation messages and malformed signatures", async () => {
    const f = fixture();
    await expect(f.signer.derive(await OTHER.signMessage({ message: f.signer.context.derivationMessage }))).rejects.toThrow("owner refused");
    await expect(f.signer.derive(await OWNER.signMessage({ message: "Keryx spending session key v1" }))).rejects.toThrow("owner refused");
    await expect(f.signer.derive("0x01")).rejects.toThrow("owner refused");
    await expect(f.signer.derive(`0x${"00".repeat(65)}`)).rejects.toThrow("owner refused");
    expect(f.keys.keys.size).toBe(0);
  });

  it("authenticates context/address AAD even if an adapter accidentally reuses a wrapping key", async () => {
    const keys = store();
    const f = await derive(fixture(INPUT, keys));
    const nextInput = { ...INPUT, epoch: "other-epoch" };
    const other = fixture(nextInput, keys).signer;
    keys.keys.set(other.context.storageNamespace, keys.keys.get(f.signer.context.storageNamespace)!);
    await expect(other.restore({ ...f.blob, contextDigest: other.context.digest })).rejects.toThrow();
    await expect(f.signer.restore({ ...f.blob, address: OTHER.address })).rejects.toThrow();
    const changed = structuredClone(f.blob); changed.wrapped[0] ^= 1;
    await expect(f.signer.restore(changed)).rejects.toThrow();
  });

  it("refuses an extractable or weaker wrapping key without publishing encrypted custody", async () => {
    for (const [length, extractable] of [[256, true], [128, false]] as const) {
      const unsafe = await crypto.subtle.generateKey({ name: "AES-GCM", length }, extractable, ["encrypt", "decrypt"]);
      const signer = createIsolatedSessionSigner(INPUT, { store: { getOrCreate: async () => unsafe, destroy: async () => {} },
        currentOrigin: () => INPUT.origin, nowSeconds: () => NOW, authorisedPayees: async () => new Set([PAYEE.toLowerCase()]) });
      await expect(signer.derive(await OWNER.signMessage({ message: signer.context.derivationMessage }))).rejects.toThrow("wrapping key refused");
    }
  });

  it("destroys only its isolated wrapping key and refuses the original ciphertext after clear", async () => {
    const f = await derive();
    const other = await derive(fixture({ ...INPUT, epoch: "other-epoch" }, f.keys));
    await f.signer.clear();
    await expect(f.signer.signPayment(payment(f.blob.address))).rejects.toThrow("key unavailable");
    await expect(f.signer.restore(f.blob)).rejects.toThrow();
    expect(await other.signer.restore(other.blob)).toBe(other.blob.address);
  });

  it("refuses foreign chain, Gateway, sender, payee and over-cap authorizations", async () => {
    const f = await derive();
    for (const mutate of [
      (p: TypedDataPayload) => { p.domain.chainId = ARC_TESTNET_PROFILE.chainId; },
      (p: TypedDataPayload) => { p.domain.verifyingContract = ARC_TESTNET_PROFILE.gatewayWallet; },
      (p: TypedDataPayload) => { p.message.from = OWNER.address; },
      (p: TypedDataPayload) => { p.message.to = OWNER.address; },
      (p: TypedDataPayload) => { p.message.value = BigInt(10001); },
    ]) { const p = payment(f.blob.address); mutate(p); await expect(f.signer.signPayment(p)).rejects.toThrow(); }
  });

  it("retains recovery after context expiry while refusing every new payment", async () => {
    const f = await derive();
    f.state.now = INPUT.expiresAtSeconds;
    expect(await f.signer.restore(f.blob)).toBe(f.blob.address);
    await expect(f.signer.signPayment(payment(f.blob.address))).rejects.toThrow("expired");
    f.state.origin = "https://other.example.invalid";
    await expect(f.signer.restore(f.blob)).rejects.toThrow("origin refused");
  });

  it("snapshots payment before await and refuses a concurrent lifecycle clear", async () => {
    let resolve: (value: ReadonlySet<string>) => void;
    const waiting = new Promise<ReadonlySet<string>>(done => { resolve = done; });
    const signer = createIsolatedSessionSigner(INPUT, { store: store(), currentOrigin: () => INPUT.origin,
      nowSeconds: () => NOW, authorisedPayees: () => waiting });
    const blob = await signer.derive(await OWNER.signMessage({ message: signer.context.derivationMessage }));
    const p = payment(blob.address); const attempt = signer.signPayment(p); p.message.to = OWNER.address;
    resolve!(new Set([PAYEE.toLowerCase()]));
    const signed = await attempt;
    expect(await recoverTypedDataAddress({ ...payment(blob.address), signature: signed } as Parameters<typeof recoverTypedDataAddress>[0])).toBe(blob.address);
    let finish: (value: ReadonlySet<string>) => void;
    const blocked = new Promise<ReadonlySet<string>>(done => { finish = done; });
    const another = createIsolatedSessionSigner(INPUT, { store: store(), currentOrigin: () => INPUT.origin,
      nowSeconds: () => NOW, authorisedPayees: () => blocked });
    const b = await another.derive(await OWNER.signMessage({ message: another.context.derivationMessage }));
    const pending = another.signPayment(payment(b.address)); await another.clear(); finish!(new Set([PAYEE.toLowerCase()]));
    await expect(pending).rejects.toThrow("lifecycle changed");
  });

  it("rechecks the origin and signing deadline after awaited payee authority", async () => {
    for (const changed of ["origin", "expiry"] as const) {
      let finish: (value: ReadonlySet<string>) => void;
      const pendingPayees = new Promise<ReadonlySet<string>>(done => { finish = done; });
      let origin = INPUT.origin, now = NOW;
      const signer = createIsolatedSessionSigner(INPUT, { store: store(), currentOrigin: () => origin,
        nowSeconds: () => now, authorisedPayees: () => pendingPayees });
      const blob = await signer.derive(await OWNER.signMessage({ message: signer.context.derivationMessage }));
      const result = signer.signPayment(payment(blob.address));
      if (changed === "origin") origin = "https://other.example.invalid";
      else now = INPUT.expiresAtSeconds;
      finish!(new Set([PAYEE.toLowerCase()]));
      await expect(result).rejects.toThrow(changed === "origin" ? "origin refused" : "expired");
    }
  });

  it("refuses new lifecycle operations until delayed wrapping-key deletion finishes", async () => {
    const keys = store();
    let release!: () => void, started!: () => void;
    const deleting = new Promise<void>(done => { started = done; });
    const gate = new Promise<void>(done => { release = done; });
    const adapter: WrappingKeyStore = { getOrCreate: keys.getOrCreate.bind(keys),
      async destroy(namespace) { started(); await gate; await keys.destroy(namespace); } };
    const signer = createIsolatedSessionSigner(INPUT, { store: adapter, currentOrigin: () => INPUT.origin,
      nowSeconds: () => NOW, authorisedPayees: async () => new Set([PAYEE.toLowerCase()]) });
    const signature = await OWNER.signMessage({ message: signer.context.derivationMessage });
    const blob = await signer.derive(signature);
    const cleared = signer.clear(); await deleting;
    expect(signer.clear()).toBe(cleared);
    await expect(signer.derive(signature)).rejects.toThrow("lifecycle busy");
    await expect(signer.restore(blob)).rejects.toThrow("lifecycle busy");
    await expect(signer.signPayment(payment(blob.address))).rejects.toThrow("key unavailable");
    release(); await cleared;
    expect(keys.keys.size).toBe(0);
    await expect(signer.restore(blob)).rejects.toThrow();
  });

  it("cancels a delayed derivation before deleting its wrapping key", async () => {
    const keys = store();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(done => { started = done; });
    const gate = new Promise<void>(done => { release = done; });
    const adapter: WrappingKeyStore = {
      async getOrCreate(namespace, candidate) { const key = await keys.getOrCreate(namespace, candidate); started(); await gate; return key; },
      destroy: keys.destroy.bind(keys),
    };
    const signer = createIsolatedSessionSigner(INPUT, { store: adapter, currentOrigin: () => INPUT.origin,
      nowSeconds: () => NOW, authorisedPayees: async () => new Set([PAYEE.toLowerCase()]) });
    const signature = await OWNER.signMessage({ message: signer.context.derivationMessage });
    const deriving = signer.derive(signature); await entered;
    const refused = expect(deriving).rejects.toThrow("lifecycle changed");
    const clearing = signer.clear(); release(); await refused; await clearing;
    expect(keys.keys.size).toBe(0);
  });

  it("restores the detached original envelope when input mutates during key lookup", async () => {
    const f = await derive();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(done => { started = done; });
    const gate = new Promise<void>(done => { release = done; });
    const adapter: WrappingKeyStore = {
      async getOrCreate(namespace, candidate) { const key = await f.keys.getOrCreate(namespace, candidate); started(); await gate; return key; },
      destroy: f.keys.destroy.bind(f.keys),
    };
    const signer = createIsolatedSessionSigner(INPUT, { store: adapter, currentOrigin: () => INPUT.origin,
      nowSeconds: () => NOW, authorisedPayees: async () => new Set([PAYEE.toLowerCase()]) });
    const originalAddress = f.blob.address;
    const restoring = signer.restore(f.blob); await entered;
    f.blob.address = OTHER.address; f.blob.iv.fill(0); f.blob.wrapped.fill(0);
    release(); expect(await restoring).toBe(originalAddress);
  });

  it("freezes validated context and rejects untrusted profiles and non-canonical origins", () => {
    const input = { ...INPUT }; const context = createIsolatedSessionContext(input);
    input.origin = "https://other.example.invalid";
    expect(context.origin).toBe(INPUT.origin); expect(Object.isFrozen(context)).toBe(true);
    for (const origin of ["http://pilot.example.invalid", `${INPUT.origin}/`, `${INPUT.origin}/path`, "https://user:pass@pilot.example.invalid", "bad"])
      expect(() => createIsolatedSessionContext({ ...INPUT, origin })).toThrow();
    expect(() => createIsolatedSessionContext({ ...INPUT, profile: { ...ARC_MAINNET_PROFILE } })).toThrow();
    expect(() => createIsolatedSessionContext({ ...INPUT, maxPaymentMicroUsdc: "10001" })).toThrow();
  });

  it("independently pins transaction policy and rejects changed network profiles", () => {
    const policy = createSessionSigningPolicy(ARC_MAINNET_PROFILE);
    const tx = { to: ARC_MAINNET_PROFILE.usdcAddress, from: OWNER.address, chainId: 5042, value: BigInt(0),
      nonce: 0, gas: BigInt(100000), maxFeePerGas: BigInt(1), maxPriorityFeePerGas: BigInt(0),
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ARC_MAINNET_PROFILE.gatewayWallet, BigInt(10000)] }) };
    expect(() => policy.validateTransaction(tx, OWNER.address)).not.toThrow();
    expect(() => policy.validateTransaction({ ...tx, chainId: 5042002 }, OWNER.address)).toThrow();
    expect(() => createSessionSigningPolicy({ ...ARC_MAINNET_PROFILE })).toThrow("untrusted network profile");
    // The isolated pilot signer exposes no transaction interface; prefunding is an independent domain.
    expect("signTransaction" in fixture().signer).toBe(false);
  });
});

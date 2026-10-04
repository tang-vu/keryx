import { expect, it } from "vitest";
import { SessionCustodyMissingError } from "./session-custody-error";
import { privateKeyToAccount } from "viem/accounts";
import { createBrowserSessionKey, type RetainedSessionStore } from "./browser-session-key";
import type { IsolatedWrappedKey, WrappingKeyStore } from "./isolated-session-vault";
import { concatHex, hashTypedData, keccak256, recoverMessageAddress, recoverTypedDataAddress, type Hex } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage } from "../payments/session-grant-consent";
import { prepareWithdrawIntentForProfile } from "../gateway/withdraw-intent-core";
import { withdrawPolicySchema, withdrawTypedData } from "../gateway/withdraw-protocol";
import type { SessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";

function memory() {
  const keys = new Map<string, CryptoKey>(), blobs = new Map<string, IsolatedWrappedKey>();
  const wrappingKeys: WrappingKeyStore = { async getOrCreate(namespace, key) {
    if (!keys.has(namespace)) keys.set(namespace, key); return keys.get(namespace)!;
  }, async destroy() { throw new Error("Funded recovery must never be destroyed"); } };
  const retained: RetainedSessionStore = { async read(namespace) { return structuredClone(blobs.get(namespace) ?? null); },
    async retain(namespace, blob) { if (!blobs.has(namespace)) blobs.set(namespace, structuredClone(blob)); return structuredClone(blobs.get(namespace)!); } };
  return { wrappingKeys, retained };
}
it("distinguishes absent custody from failed reads or corrupt retained ciphertext", async () => {
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), stores = memory();
  const key = createBrowserSessionKey("https://keryx.cc", owner.address, stores);
  await expect(key.restore()).rejects.toBeInstanceOf(SessionCustodyMissingError);
  const read = stores.retained.read;
  stores.retained.read = async () => { throw new Error("IndexedDB unavailable"); };
  await expect(key.restore()).rejects.toThrow("IndexedDB unavailable");
  stores.retained.read = read;
  await key.derive(await owner.signMessage({ message: key.context.derivationMessage }));
  key.lock();
  stores.retained.read = async namespace => {
    const blob = (await read(namespace))!;
    blob.wrapped[0] ^= 1;
    return blob;
  };
  await expect(key.restore()).rejects.not.toBeInstanceOf(SessionCustodyMissingError);
  expect(key.address).toBeNull();
});

it("restores original mainnet custody across logout and key derivation changes without a wallet signature", async () => {
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), stores = memory();
  const first = createBrowserSessionKey("https://keryx.cc", owner.address, stores);
  const signature = await owner.signMessage({ message: first.context.derivationMessage });
  const original = await first.derive(signature);
  first.lock(); expect(first.address).toBeNull();
  expect(await first.restore()).toEqual(original);
  first.lock();
  const reloaded = createBrowserSessionKey("https://keryx.cc", owner.address, stores);
  expect(await reloaded.restore()).toEqual(original);
  const curveOrder = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
  const alternate = `0x${signature.slice(2,66)}${(curveOrder-BigInt(`0x${signature.slice(66,130)}`)).toString(16).padStart(64,"0")}${signature.slice(130)==="1b"?"1c":"1b"}` as Hex;
  expect(alternate).not.toBe(signature);
  expect((await recoverMessageAddress({ message: reloaded.context.derivationMessage, signature: alternate })).toLowerCase()).toBe(reloaded.context.owner);
  expect(await reloaded.derive(alternate)).toEqual(original);
  await expect(createBrowserSessionKey("https://other.test", owner.address, stores).restore()).rejects.toThrow();
  const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
  await expect(reloaded.derive(await other.signMessage({ message: first.context.derivationMessage }))).rejects.toThrow();
});
it("does not publish custody if a lock occurs while its durable ciphertext commit awaits", async () => {
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), stores = memory();
  let resume!: () => void, started!: () => void;
  const pending = new Promise<void>(resolve => { resume = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const retain = stores.retained.retain;
  stores.retained.retain = async (...args) => { started(); await pending; return retain(...args); };
  const key = createBrowserSessionKey("https://keryx.cc", owner.address, stores);
  const derivation = key.derive(await owner.signMessage({ message: key.context.derivationMessage }));
  await entered; key.lock(); resume();
  await expect(derivation).rejects.toThrow("Browser session custody unavailable");
  expect(key.address).toBeNull();
  expect((await key.restore()).address).toMatch(/^0x/);
});

it("restores expired custody for an owner-only finite burn while refusing expired payment consent", async () => {
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), stores = memory();
  const key = createBrowserSessionKey("https://keryx.cc", owner.address, stores);
  const derivation = await owner.signMessage({ message: key.context.derivationMessage });
  const original = await key.derive(derivation);
  const fixtureSigner = privateKeyToAccount(keccak256(concatHex([key.context.digest, derivation])));
  const consent = { format: "keryx-session-grant-consent-v1" as const, network: profile.networkId, origin: key.context.origin,
    ownerAddr: key.context.owner, sessAddr: original.address.toLowerCase(), grantEpoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    capMicroUsdc: "1000000", expirySeconds: "1" };
  const authorization = { consent, ownerSignature: await owner.signMessage({ message: createSessionGrantConsentMessage(consent, profile) }),
    sessionSignature: await fixtureSigner.signMessage({ message: createSessionGrantSignerProofMessage(consent, profile) }) };
  const burnIntent = { ...prepareWithdrawIntentForProfile(profile, consent.sessAddr, "500000", consent.ownerAddr, "1000"), maxBlockHeight: "1100" };
  const prepared: SessionWithdrawalPreparation = { format: "keryx-session-withdrawal-preparation-v1", network: profile.networkId,
    requestId: hashTypedData(withdrawTypedData(burnIntent)), ownerAddr: consent.ownerAddr, sessAddr: consent.sessAddr,
    grantEpoch: consent.grantEpoch, authorization, burnIntent,
    policy: withdrawPolicySchema.parse({ owner: consent.sessAddr, recipient: consent.ownerAddr, domain: profile.cctpDomain,
      gatewayWallet: profile.gatewayWallet, gatewayMinter: profile.gatewayMinter, asset: profile.usdcAddress,
      maxValueMicros: "500000", maxFeeMicros: "1000" }),
    balance: { availableMicroUsdc: "1000000", heldPaymentMicroUsdc: "100000", heldWithdrawalMicroUsdc: "0", confirmedSpentMicroUsdc: "0", maxFeeMicroUsdc: "1000" },
    height: { minimumBlockHeight: "1100", maximumBlockHeight: "1200", observedBlockNumber: "1000",
      observedBlockHash: `0x${"55".repeat(32)}`, observedAt: new Date().toISOString() } };
  key.lock(); await key.restore();
  await expect(key.signGrantConsentProof(consent, authorization.ownerSignature)).rejects.toThrow();
  const signature = await key.signWithdrawalPreparation(prepared);
  expect((await recoverTypedDataAddress({ ...withdrawTypedData(burnIntent), signature })).toLowerCase()).toBe(consent.sessAddr);
  const wrongOrigin = structuredClone(prepared);
  wrongOrigin.authorization.consent = { ...wrongOrigin.authorization.consent, origin: "https://other.test" };
  wrongOrigin.authorization.ownerSignature = await owner.signMessage({ message: createSessionGrantConsentMessage(wrongOrigin.authorization.consent, profile) });
  wrongOrigin.authorization.sessionSignature = await fixtureSigner.signMessage({ message: createSessionGrantSignerProofMessage(wrongOrigin.authorization.consent, profile) });
  await expect(key.signWithdrawalPreparation(wrongOrigin)).rejects.toThrow("Browser session custody unavailable");
  const changedRecipient = structuredClone(prepared); changedRecipient.policy.recipient = consent.sessAddr as Hex;
  await expect(key.signWithdrawalPreparation(changedRecipient)).rejects.toThrow();
});

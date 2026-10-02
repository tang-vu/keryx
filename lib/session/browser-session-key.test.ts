import { expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createBrowserSessionKey, type RetainedSessionStore } from "./browser-session-key";
import type { IsolatedWrappedKey, WrappingKeyStore } from "./isolated-session-vault";
import { recoverMessageAddress, type Hex } from "viem";

function memory() {
  const keys = new Map<string, CryptoKey>(), blobs = new Map<string, IsolatedWrappedKey>();
  const wrappingKeys: WrappingKeyStore = { async getOrCreate(namespace, key) {
    if (!keys.has(namespace)) keys.set(namespace, key); return keys.get(namespace)!;
  }, async destroy() { throw new Error("Funded recovery must never be destroyed"); } };
  const retained: RetainedSessionStore = { async read(namespace) { return structuredClone(blobs.get(namespace) ?? null); },
    async retain(namespace, blob) { if (!blobs.has(namespace)) blobs.set(namespace, structuredClone(blob)); return structuredClone(blobs.get(namespace)!); } };
  return { wrappingKeys, retained };
}
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

import { concatHex, keccak256, recoverMessageAddress, type Hex, type TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { createIsolatedSessionContext, type IsolatedSessionContextInput } from "./isolated-session-context";
import { createIsolatedSessionVault, type IsolatedWrappedKey, type WrappingKeyStore } from "./isolated-session-vault";
import { createSessionSigningPolicy } from "./session-signing-policy";
import type { TypedDataPayload } from "./session-signer-protocol";

/** Dormant worker building block. No public worker/client/route imports this factory.
 * Instantiate only in a dedicated reviewed entry with local candidate context and authoritative
 * payee lookup. No request can replace context. Server journal still owns nonces/lifetime caps.
 */
export function createIsolatedSessionSigner(input: IsolatedSessionContextInput, dependencies: {
  store: WrappingKeyStore;
  currentOrigin: () => string;
  authorisedPayees: () => Promise<ReadonlySet<string>>;
  nowSeconds?: () => number;
}) {
  const context = createIsolatedSessionContext(input);
  const policy = createSessionSigningPolicy(context.profile);
  const vault = createIsolatedSessionVault(context, dependencies.store);
  // Capture dependencies once; the page or caller cannot swap them during an awaited operation.
  const origin = dependencies.currentOrigin, payees = dependencies.authorisedPayees;
  const clock = dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  let account: PrivateKeyAccount | null = null;
  let generation = 0;
  let lifecycleBusy = false;
  let lifecycleDone: Promise<void> = Promise.resolve();
  let clearing: Promise<void> | null = null;
  async function lifecycle<T>(operation: (capturedGeneration: number) => Promise<T>): Promise<T> {
    if (lifecycleBusy || clearing) throw new Error("isolated session lifecycle busy");
    lifecycleBusy = true;
    account = null;
    const capturedGeneration = ++generation;
    let completed!: () => void;
    lifecycleDone = new Promise<void>(resolve => { completed = resolve; });
    try { return await operation(capturedGeneration); }
    finally { lifecycleBusy = false; completed(); }
  }
  function checkOrigin() {
    if (origin() !== context.origin) throw new Error("isolated session origin refused");
  }
  function checkSigning() {
    checkOrigin();
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0 || now >= context.expiresAtSeconds) throw new Error("isolated session signing context expired");
    return now;
  }
  return Object.freeze({
    context,
    derive(signature: Hex): Promise<IsolatedWrappedKey> {
      return lifecycle(async capturedGeneration => {
        checkOrigin();
        let recoveredOwner: string;
        try {
          if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error();
          recoveredOwner = await recoverMessageAddress({ message: context.derivationMessage, signature });
        } catch {
          // Vendor diagnostics may include the derivation bearer signature. Keep them inside worker.
          throw new Error("isolated session derivation owner refused");
        }
        if (recoveredOwner.toLowerCase() !== context.owner)
          throw new Error("isolated session derivation owner refused");
        // Even accidental reuse of a wallet signature cannot derive the legacy testnet key.
        const privateKey = keccak256(concatHex([context.digest, signature]));
        const derived = privateKeyToAccount(privateKey);
        const wrapped = await vault.wrap(privateKey, derived.address);
        checkOrigin();
        if (generation !== capturedGeneration) throw new Error("isolated session lifecycle changed");
        account = derived;
        return wrapped;
      });
    },
    restore(blob: IsolatedWrappedKey): Promise<Hex> {
      const snapshot = structuredClone(blob);
      return lifecycle(async capturedGeneration => {
        checkOrigin();
        const restored = privateKeyToAccount(await vault.unwrap(snapshot) as Hex);
        if (restored.address.toLowerCase() !== snapshot.address.toLowerCase()) throw new Error("isolated session address refused");
        checkOrigin();
        if (generation !== capturedGeneration) throw new Error("isolated session lifecycle changed");
        account = restored;
        return restored.address;
      });
    },
    async signPayment(payload: TypedDataPayload): Promise<Hex> {
      const now = checkSigning();
      const signer = account;
      const capturedGeneration = generation;
      if (!signer) throw new Error("isolated session key unavailable");
      const snapshot = structuredClone(payload);
      policy.validatePayment(snapshot, signer.address, now);
      if (BigInt(snapshot.message.value as bigint) > BigInt(context.maxPaymentMicroUsdc)) throw new Error("isolated session payment bound exceeded");
      const authorised = await payees();
      if (!authorised.has(String(snapshot.message.to).toLowerCase())) throw new Error("isolated session payee refused");
      policy.validatePayment(snapshot, signer.address, checkSigning());
      if (generation !== capturedGeneration || account !== signer) throw new Error("isolated session lifecycle changed");
      const signature = await signer.signTypedData({ domain: snapshot.domain as TypedDataDomain, types: snapshot.types,
        primaryType: snapshot.primaryType, message: snapshot.message } as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
      checkSigning();
      if (generation !== capturedGeneration || account !== signer) throw new Error("isolated session lifecycle changed");
      return signature;
    },
    clear(): Promise<void> {
      if (clearing) return clearing;
      generation += 1;
      account = null;
      clearing = (async () => {
        // Cancel publication from any outstanding derive/restore, then destroy after its storage
        // work ends. New lifecycle calls refuse until deletion and the final generation boundary.
        try { await lifecycleDone; await vault.destroy(); }
        finally { generation += 1; account = null; clearing = null; }
      })();
      return clearing;
    },
  });
}

/**
 * The session signer. Runs in a dedicated Web Worker; the private key never leaves this scope.
 *
 * Why a worker rather than a non-exportable `CryptoKey`: `crypto.subtle` implements P-256/384/521
 * and no secp256k1 curve, so an Ethereum key can never be a `CryptoKey` the browser refuses to
 * export. A worker gives the same property by a different route — the key sits in a heap the main
 * thread cannot address, and the only way to reach it is to ask this file to sign something.
 *
 * So this file decides what is worth signing. It refuses any payee the on-chain registry does not
 * authorise, and any transaction that is not an approve/deposit against the Gateway. Injected
 * script on the page can call in here, but everything it can obtain is a payment to a real creator
 * from a session the user funded on purpose.
 *
 * Residual, stated plainly: the key is derived as `keccak256(walletSignature)`, and that signature
 * is produced on the main thread by the user's wallet. Script that is already running at that exact
 * moment can take the signature and derive the key itself. The window is one call during session
 * setup, not the lifetime of the session.
 */

import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount, TransactionSerializable, TypedDataDomain } from "viem";
import { wrapKey, unwrapKey, destroyWrappingKey } from "./session-key-vault";
import { authorisedPayees, isAllowedTransactionTarget } from "./session-payee-policy";
import type { DerivedSession, SignerRequest, SignerResponse, TypedDataPayload } from "./session-signer-protocol";

/** The only thing in this file that must never escape it. */
let account: PrivateKeyAccount | null = null;

/** The x402 authorization the browser is meant to co-sign, and nothing else. */
const PAYMENT_PRIMARY_TYPE = "TransferWithAuthorization";

function requireAccount(): PrivateKeyAccount {
  if (!account) throw new Error("no session key loaded in the signer");
  return account;
}

async function deriveFromSignature(signature: string): Promise<DerivedSession> {
  // keccak256 of a signature is a uniformly distributed 32 bytes — a valid secp256k1 key.
  const privateKey = keccak256(signature as `0x${string}`);
  account = privateKeyToAccount(privateKey);
  const { wrapped, iv } = await wrapKey(privateKey);
  return { address: account.address, wrapped, iv };
}

async function restore(wrapped: Uint8Array, iv: Uint8Array): Promise<{ address: `0x${string}` }> {
  const privateKey = await unwrapKey({ wrapped, iv });
  account = privateKeyToAccount(privateKey as `0x${string}`);
  return { address: account.address };
}

/**
 * Sign an x402 payment authorization, but only after the registry agrees the payee may be paid.
 * The signature is a bearer instrument: once it exists, whoever holds it can move that USDC to
 * `to`. So the check has to happen here, before the signature does.
 */
async function signTypedData(payload: TypedDataPayload): Promise<string> {
  const signer = requireAccount();

  if (payload.primaryType !== PAYMENT_PRIMARY_TYPE) {
    throw new Error(`the session key signs ${PAYMENT_PRIMARY_TYPE} only, not ${payload.primaryType}`);
  }

  const to = payload.message.to;
  if (typeof to !== "string") throw new Error("payment authorization has no payee");

  const payees = await authorisedPayees();
  if (!payees.has(to.toLowerCase())) {
    throw new Error(`${to} is not an authorised payee of any registered source`);
  }

  return signer.signTypedData({
    domain: payload.domain as TypedDataDomain,
    types: payload.types,
    primaryType: payload.primaryType,
    message: payload.message,
  } as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
}

/** Sign an approve or a Gateway deposit. Never a value transfer out of the session EOA. */
async function signTransaction(transaction: Record<string, unknown>): Promise<string> {
  const signer = requireAccount();
  const to = transaction.to as string | undefined;

  if (!isAllowedTransactionTarget(to)) {
    throw new Error(`the session key will not sign a transaction to ${to ?? "a new contract"}`);
  }

  const from = transaction.from as string | undefined;
  if (from && from.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`this session key is ${signer.address}, not ${from}`);
  }

  // `from` is not part of a serialized transaction; viem's serializer ignores it, but drop it here
  // so the shape handed to the signer is exactly the transaction and nothing else.
  const { from: _ignored, ...serializable } = transaction;
  return signer.signTransaction(serializable as unknown as TransactionSerializable);
}

async function clear(): Promise<null> {
  account = null;
  // Any ciphertext still sitting in a tab becomes permanently unreadable. A user who wants the
  // session back signs the derivation message again, which reproduces the same key.
  await destroyWrappingKey();
  return null;
}

/** Exported so the refusals above can be tested without spinning up a real worker. */
export async function handleSignerRequest(request: SignerRequest): Promise<unknown> {
  switch (request.type) {
    case "deriveFromSignature":
      return deriveFromSignature(request.signature);
    case "restore":
      return restore(request.wrapped, request.iv);
    case "signTypedData":
      return signTypedData(request.payload);
    case "signTransaction":
      return signTransaction(request.transaction);
    case "clear":
      return clear();
  }
}

// Only wire the port when this module really is a worker. Under the test runner it is an ordinary
// module and `self` is either absent or the Node global, which has no worker message port.
const isWorkerScope =
  typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function";

if (isWorkerScope) {
  self.addEventListener("message", (event: MessageEvent<SignerRequest>) => {
    const request = event.data;
    void handleSignerRequest(request)
      .then((result) => {
        const response: SignerResponse = { id: request.id, ok: true, result };
        self.postMessage(response);
      })
      .catch((err: unknown) => {
        const response: SignerResponse = {
          id: request.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        self.postMessage(response);
      });
  });
}

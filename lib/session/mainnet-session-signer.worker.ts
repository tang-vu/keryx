/// <reference lib="webworker" />
import { browserPaymentProfile } from "../browser-payment-profile";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { createBrowserSessionKey, indexedDbRetainedSessionStore } from "./browser-session-key";
import { indexedDbWrappingKeyStore } from "./isolated-session-vault";
import { createBrowserSessionRuntime, type BrowserSessionOperation } from "./browser-session-runtime";
import { sessionJson } from "./browser-session-http";
import { readBrowserMainnetSource } from "./browser-session-source-authority";
import { reserveBrowserSessionAuthorization } from "./browser-session-capacity";
import { createBrowserSessionWithdrawalRuntime } from "./browser-session-withdrawal-runtime";
import { SessionCustodyMissingError } from "./session-custody-error";
declare const self: DedicatedWorkerGlobalScope;
let key: ReturnType<typeof createBrowserSessionKey> | null = null;
let runtime: ReturnType<typeof createBrowserSessionRuntime> | null = null;
let cashout: ReturnType<typeof createBrowserSessionWithdrawalRuntime> | null = null;
let active = false, generation = 0;
self.onmessage = (event: MessageEvent<BrowserSessionOperation & { id: number }>) => {
  const request = event.data;
  if (!Number.isSafeInteger(request?.id) || request.id < 0) return;
  if (request.type === "lock") {
    generation += 1; cashout?.lock(); runtime?.lock();
    self.postMessage({ id: request.id, ok: true, result: null }); return;
  }
  if (active || browserPaymentProfile() !== ARC_MAINNET_PROFILE) {
    self.postMessage({ id: request.id, ok: false, error: "Browser session unavailable" }); return;
  }
  active = true; const expected = generation;
  void (async () => {
    if (request.type === "initializeOwner") {
      const candidate = createBrowserSessionKey(self.location.origin, request.owner,
        { wrappingKeys: indexedDbWrappingKeyStore(), retained: indexedDbRetainedSessionStore() });
      if (key && key.context.digest !== candidate.context.digest) { cashout?.lock(); runtime?.lock(); key = null; runtime = null; cashout = null; }
      key ??= candidate;
      runtime ??= createBrowserSessionRuntime(key, { json: sessionJson, readSource: readBrowserMainnetSource, reserve: reserveBrowserSessionAuthorization });
      cashout ??= createBrowserSessionWithdrawalRuntime(key, { json: sessionJson });
      return { derivationMessage: key.context.derivationMessage, storageNamespace: key.context.storageNamespace };
    }
    if (!key || !runtime) throw new Error();
    switch (request.type) {
      case "deriveFromSignature": return key.derive(request.signature);
      case "restoreRetained": return key.restore();
      case "bindGrant": return runtime.bindGrant();
      case "signGrantConsentProof": return key.signGrantConsentProof(request.consent, request.ownerSignature);
      case "authorizePayment": return runtime.authorizePayment(request.reqId, request.question);
      case "signWithdrawal": return cashout!.signWithdrawal(request.requestId, request.review);
      case "cancelUnexposedWithdrawal": return cashout!.cancelUnexposedWithdrawal(request.requestId);
      case "reconcileWithdrawal": return cashout!.reconcileWithdrawal(request.requestId);
      default: throw new Error();
    }
  })().then(result => {
    if (expected !== generation) throw new Error();
    self.postMessage({ id: request.id, ok: true, result });
  }).catch(error => self.postMessage({ id: request.id, ok: false, error: "Browser session operation refused",
    ...(expected === generation && request.type === "restoreRetained" && error instanceof SessionCustodyMissingError
      ? { code: error.code } : {}) }))
    .finally(() => { active = false; });
};

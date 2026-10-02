/// <reference lib="webworker" />
import { browserPaymentProfile } from "../browser-payment-profile";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { createBrowserSessionKey, indexedDbRetainedSessionStore } from "./browser-session-key";
import { indexedDbWrappingKeyStore } from "./isolated-session-vault";
import { createBrowserSessionRuntime, type BrowserSessionOperation } from "./browser-session-runtime";
import { sessionJson } from "./browser-session-http";
import { readBrowserMainnetSource } from "./browser-session-source-authority";
import { reserveBrowserSessionAuthorization } from "./browser-session-capacity";
declare const self: DedicatedWorkerGlobalScope;
let key: ReturnType<typeof createBrowserSessionKey> | null = null;
let runtime: ReturnType<typeof createBrowserSessionRuntime> | null = null;
let active = false, generation = 0;
self.onmessage = (event: MessageEvent<BrowserSessionOperation & { id: number }>) => {
  const request = event.data;
  if (!Number.isSafeInteger(request?.id) || request.id < 0) return;
  if (request.type === "lock") {
    generation += 1; runtime?.lock();
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
      if (key && key.context.digest !== candidate.context.digest) { runtime?.lock(); key = null; runtime = null; }
      key ??= candidate;
      runtime ??= createBrowserSessionRuntime(key, { json: sessionJson, readSource: readBrowserMainnetSource, reserve: reserveBrowserSessionAuthorization });
      return { derivationMessage: key.context.derivationMessage, storageNamespace: key.context.storageNamespace };
    }
    if (!key || !runtime) throw new Error();
    switch (request.type) {
      case "deriveFromSignature": return key.derive(request.signature);
      case "restoreRetained": return key.restore();
      case "bindGrant": return runtime.bindGrant();
      case "signGrantConsentProof": return key.signGrantConsentProof(request.consent, request.ownerSignature);
      case "authorizePayment": return runtime.authorizePayment(request.reqId);
      default: throw new Error();
    }
  })().then(result => {
    if (expected !== generation) throw new Error();
    self.postMessage({ id: request.id, ok: true, result });
  }).catch(() => self.postMessage({ id: request.id, ok: false, error: "Browser session operation refused" }))
    .finally(() => { active = false; });
};

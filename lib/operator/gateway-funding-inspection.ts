import { createHash } from "node:crypto";
import { fstatSync, readSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { canonicalJson } from "../canonical-json";
import { inspectStorageDeploymentManifest } from "../db/runtime-storage-config";
import { holdStorageTarget } from "../db/storage-identity-sqlite";
import { storageIdentityDigest } from "../db/storage-identity";
import { openGatewayFundingSqliteLedger } from "../db/gateway-funding-sqlite";
import { validateFundingNamespace } from "../db/gateway-funding-ledger-validation";
import { gatewayFundingReplayDigest, validateGatewayFundingOperation } from "../payments/gateway-funding-policy";
import { observeGatewayFundingReadinessForInspection, assertVerifiedGatewayFundingReadinessCurrent,
  createGatewayFundingReadinessInspectionObserverForTrustedSyntheticComposition, type GatewayFundingReadinessRequest } from "../payments/gateway-funding-readiness";
import type { VerifiedGatewayFundingReadiness } from "../payments/gateway-funding-readiness";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../payments/gateway-funding-receipt-policy";
import { validateGatewayFundingOperationLocator } from "../payments/gateway-funding-operation-locator";

const now = performance.now.bind(performance), MAX_BYTES = 8192, TOTAL_MS = 20000;
function refuse(): never { throw new Error("Funding inspection unavailable; private details omitted"); }
function digest(value: unknown) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
export interface GatewayFundingInspectionOptions {
  readonly storageManifestPath: string;
  readonly operationManifestPath: string;
  readonly currentAvailability: boolean;
}
function exact(input: unknown, keys: readonly string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length) refuse();
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(fields).sort().join(",") !== [...keys].sort().join(",") || Object.values(fields).some(f => !("value" in f) || !f.enumerable)) refuse();
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value]));
}
function readCanonical(held: ReturnType<typeof holdStorageTarget>) {
  held.verify(); const before = fstatSync(held.descriptor, { bigint: true });
  if (before.size <= BigInt(0) || before.size > BigInt(MAX_BYTES)) refuse();
  const bytes = Buffer.alloc(MAX_BYTES + 1); let count = 0;
  for (;;) { const n = readSync(held.descriptor, bytes, count, bytes.length - count, count); count += n; if (!n || count === bytes.length) break; }
  const after = fstatSync(held.descriptor, { bigint: true }); held.verify();
  if (count > MAX_BYTES || BigInt(count) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs) refuse();
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, count));
  const wire = text.endsWith("\n") ? text.slice(0, -1) : text, value: unknown = JSON.parse(wire);
  if (canonicalJson(value) !== wire) refuse(); return value;
}
/** Keyless trusted host helper. The supported CLI runs it inside a killable
 * minimal-environment child; V8 heap limits do not bound native SQLite RSS. */
async function inspect(inputOptions: GatewayFundingInspectionOptions, observe: typeof observeGatewayFundingReadinessForInspection) {
  const started = now();
  let phase = "open";
  let storageHeld: ReturnType<typeof holdStorageTarget> | undefined, operationHeld: typeof storageHeld;
  let ledger: ReturnType<typeof openGatewayFundingSqliteLedger> | undefined;
  const elapsed = () => { const n = now() - started; if (!Number.isFinite(n) || n < 0 || n >= TOTAL_MS) refuse(); };
  try {
    const options = Object.freeze(exact(inputOptions, ["storageManifestPath", "operationManifestPath", "currentAvailability"])) as unknown as Readonly<GatewayFundingInspectionOptions>;
    if (typeof options.storageManifestPath !== "string" || typeof options.operationManifestPath !== "string" || typeof options.currentAvailability !== "boolean") refuse();
    elapsed(); storageHeld = holdStorageTarget(options.storageManifestPath); elapsed(); operationHeld = holdStorageTarget(options.operationManifestPath); elapsed();
    const rawStorage = readCanonical(storageHeld), proof = validateGatewayFundingOperationLocator(readCanonical(operationHeld)); elapsed();
    if (proof.finalityPolicyDigest !== GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST) refuse();
    const storage = inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: options.storageManifestPath }); elapsed();
    if (storage.backend.kind !== "sqlite" || storage.identity.authorityMode !== "testnet-real" || digest(rawStorage) !== proof.storageManifestDigest
      || storageIdentityDigest(storage.identity) !== proof.identityDigest) refuse();
    ledger = openGatewayFundingSqliteLedger(storage.backend.databasePath, storage.identity, { readOnly: true }); elapsed();
    const guard = () => {
      elapsed();
      // readCanonical verifies the held path/descriptor both before and after
      // reading. Exact canonical bytes retain the already validated manifest
      // semantics; rereading/parsing the same path adds no authority evidence.
      if (digest(readCanonical(storageHeld!)) !== proof.storageManifestDigest || canonicalJson(validateGatewayFundingOperationLocator(readCanonical(operationHeld!))) !== canonicalJson(proof)
        || storageIdentityDigest(ledger!.getStorageIdentity()) !== proof.identityDigest) refuse(); elapsed();
    };
    const load = async () => {
      guard(); const operation = validateGatewayFundingOperation(await ledger!.inspectOperation(proof.operationId)); guard();
      if (operation.operationId !== proof.operationId || storageIdentityDigest(operation.policy.identity) !== proof.identityDigest || digest(operation.policy) !== proof.installedPolicyDigest) refuse();
      const namespaces = [];
      for (const role of ["funder", "spend"] as const) {
        guard(); const ns = validateFundingNamespace(await ledger!.inspectNamespace(operation.policy[role]), storage.identity, proof.backendBindingDigest); guard();
        if (ns.role !== role || ns.sender !== operation.policy[role] || ns.peer !== operation.policy[role === "funder" ? "spend" : "funder"] || ns.finalityPolicyDigest !== proof.finalityPolicyDigest) refuse(); namespaces.push(ns);
      }
      if (namespaces[0].historyDocumentDigest !== namespaces[1].historyDocumentDigest || namespaces[0].limits.nativeWei !== operation.policy.lifetimeLimits.nativeWei
        || namespaces[0].limits.usdcMicros !== operation.policy.lifetimeLimits.usdcMicros || namespaces[1].limits.depositMicros !== operation.policy.lifetimeLimits.depositMicros
        || BigInt(namespaces[0].limits.gasWei) + BigInt(namespaces[1].limits.gasWei) > BigInt(operation.policy.lifetimeLimits.gasWei)) refuse();
      const steps: Record<string, string> = {}, originals: Record<string, unknown> = {};
      for (const step of ["nativeTransfer", "usdcTransfer", "approval", "deposit"] as const) {
        guard(); const slot = await ledger!.inspectReservation(proof.operationId, step); guard();
        if (slot && gatewayFundingReplayDigest(slot.operation) !== gatewayFundingReplayDigest(operation)) refuse();
        steps[step] = slot?.state ?? "not-reserved"; originals[step] = slot;
      }
      return { operation, namespaces, steps, originals };
    };
    phase = "initial-load";
    const initial = await load(), { namespaces, steps } = initial;
    let availability: Readonly<{ status: string; availableMicros?: string; minimumAvailableMicros?: string }> = Object.freeze({ status: options.currentAvailability ? "unknown" : "not-requested" });
    const request: GatewayFundingReadinessRequest = { ledger, operationId: proof.operationId, expectedIdentity: storage.identity,
      expectedBackendBindingDigest: proof.backendBindingDigest, installedPolicyDigest: proof.installedPolicyDigest, finalityPolicyDigest: proof.finalityPolicyDigest, assertCurrentAuthority: guard };
    let currentToken: VerifiedGatewayFundingReadiness | undefined;
    if (options.currentAvailability && steps.deposit === "finalized-success") {
      try {
        phase = "observe"; guard(); const observation = await observe(request); guard();
        if (observation) { const { token, evidence } = observation; assertVerifiedGatewayFundingReadinessCurrent(token, request);
          availability = Object.freeze({ status: "observed-available-meets-minimum", availableMicros: evidence.availableMicros, minimumAvailableMicros: evidence.minimumAvailableMicros }); currentToken = token; }
      } catch { guard(); }
    }
    phase = "refreshed-load"; const refreshed = await load();
    if (canonicalJson(initial) !== canonicalJson(refreshed)) refuse();
    const report = Object.freeze({ format: "keryx-funding-inspection-report-v1", status: "inspected-originals", readOnly: true, signingResumeAuthorized: false,
      steps: Object.freeze(steps), namespaces: Object.freeze(namespaces.map(ns => Object.freeze({ role: ns.role, nextReservedNonce: ns.nextNonce, nextCryptoNonce: ns.nextCryptoNonce,
        lifetimeLimits: ns.limits, retainedExposure: ns.used, nativeAggregateLimitWei: ns.nativeAggregateLimitWei, nativeAggregateUsedWei: ns.nativeAggregateUsedWei }))), availability });
    guard(); if (Buffer.byteLength(JSON.stringify(report)) > MAX_BYTES) refuse(); guard();
    phase = "publish"; if (currentToken) assertVerifiedGatewayFundingReadinessCurrent(currentToken, request); return report;
  } catch (error) {
    const cause = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "cause")?.value : undefined;
    const tokenAgeMs = cause && Object.getOwnPropertyDescriptor(cause, "phase")?.value === "readiness-token-freshness"
      ? Object.getOwnPropertyDescriptor(cause, "tokenAgeMs")?.value : null;
    throw new Error("Funding inspection unavailable; private details omitted", { cause: Object.freeze({ phase,
      elapsedMs: Math.max(0, Math.round(now() - started)),
      tokenAgeMs: Number.isSafeInteger(tokenAgeMs) && tokenAgeMs >= 0 ? tokenAgeMs : null,
    }) });
  }
  finally { try { ledger?.close(); } finally { try { operationHeld?.close(); } finally { storageHeld?.close(); } } }
}
export function inspectGatewayFundingSqliteOperation(options: GatewayFundingInspectionOptions) { return inspect(options, observeGatewayFundingReadinessForInspection); }
/** Explicit synthetic fixture composition; the production CLI exposes no endpoint option. */
export function inspectGatewayFundingSqliteOperationForTrustedSyntheticComposition(options: GatewayFundingInspectionOptions, endpoint: string) {
  const started = now(), observer = createGatewayFundingReadinessInspectionObserverForTrustedSyntheticComposition(endpoint);
  if (now() - started >= TOTAL_MS) refuse(); return inspect(options, observer);
}

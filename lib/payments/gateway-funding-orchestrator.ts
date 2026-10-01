import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { canonicalJson } from "../canonical-json";
import { storageIdentityDigest } from "../db/storage-identity";
import { validateFundingNamespace } from "../db/gateway-funding-ledger-validation";
import type { FundingReservationSnapshot, GatewayFundingStep } from "../db/gateway-funding-ledger-types";
import { gatewayFundingReplayDigest, validateGatewayFundingOperation, type GatewayFundingOperation } from "./gateway-funding-policy";
import { validatePreparedGatewayFundingTransaction } from "./gateway-funding-transaction";
import { createGatewayFundingExecutor, createGatewayFundingExecutorForTrustedSyntheticComposition,
  createKeylessGatewayFundingReconciler, createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition,
  type GatewayFundingExecutorOptions, type GatewayFundingReconcilerOptions } from "./gateway-funding-executor";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "./gateway-funding-receipt-observer";
import { GATEWAY_FUNDING_RECEIPT_POLICY, GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "./gateway-funding-receipt-policy";
import { observeGatewayFundingReadiness, createGatewayFundingReadinessObserverForTrustedSyntheticComposition,
  unsealVerifiedGatewayFundingReadiness, assertVerifiedGatewayFundingReadinessCurrent,
  type GatewayFundingReadinessRequest, type GatewayFundingReadinessEvidence } from "./gateway-funding-readiness";

const now = performance.now.bind(performance), nativeFetch = globalThis.fetch.bind(globalThis);
const STEPS = ["nativeTransfer", "usdcTransfer", "approval", "deposit"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BINDING = ["ledger", "expectedIdentity", "installedPolicyDigest", "expectedBackendBindingDigest", "finalityPolicyDigest", "assertCurrentAuthority", "terminalStore"];
function refuse(): never { throw new Error("Funding operation unresolved; reconcile retained originals"); }
export interface GatewayFundingOrchestratorOptions extends GatewayFundingExecutorOptions {
  readonly terminalStore: GatewayFundingReconcilerOptions["terminalStore"];
}
export interface GatewayFundingOperationResult {
  readonly status: "current-funding-ready" | "reconciliation-required" | "execution-reverted" | "missing-operation";
  readonly stage: string;
  readonly step?: GatewayFundingStep;
  /** Descriptive current availability, never attributed deposit credit. */
  readonly readiness?: Readonly<GatewayFundingReadinessEvidence>;
}
type Synthetic = Readonly<{ origins: readonly [string, string]; circleEndpoint: string }>;
export interface GatewayFundingSyntheticTimings {
  readonly operationDeadlineMs: number;
  readonly keylessDeadlineMs: number;
  readonly receiptPhaseDeadlineMs: number;
}
const TIMINGS = Object.freeze({ operationDeadlineMs: 300000, keylessDeadlineMs: 30000, receiptPhaseDeadlineMs: 40000 });
function shape(value: object, keys: readonly string[]) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).sort().join() !== [...keys].sort().join() || Object.values(descriptors).some(d => !d.enumerable || !("value" in d))) refuse();
}
function syntheticTimings(value?: Readonly<GatewayFundingSyntheticTimings>) {
  if (value === undefined) return TIMINGS;
  shape(value, Object.keys(TIMINGS));
  for (const key of Object.keys(TIMINGS) as (keyof GatewayFundingSyntheticTimings)[]) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > TIMINGS[key]) refuse();
  }
  return Object.freeze({ ...value });
}
function selected(op: Readonly<GatewayFundingOperation>) {
  return STEPS.filter(step => step !== "nativeTransfer" && step !== "usdcTransfer"
    || BigInt(step === "nativeTransfer" ? op.nativeTransferWei : op.usdcTransferMicros) > BigInt(0));
}
function lifetime(options: GatewayFundingReconcilerOptions, deadlineMs: number, start = now()) {
  const identity = storageIdentityDigest(options.expectedIdentity);
  let closed = false;
  const timers = new Set<{ timer?: ReturnType<typeof setTimeout>; reject: (error: Error) => void }>();
  const arm = (entry: { timer?: ReturnType<typeof setTimeout>; reject: (error: Error) => void }) => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { closed = true; entry.reject(new Error("Funding operation deadline")); }, Math.max(1, deadlineMs - (now() - start)));
  };
  const elapsed = () => { const age = now() - start; if (closed || !Number.isFinite(age) || age < 0 || age >= deadlineMs) refuse(); };
  const live = () => { elapsed(); if (options.assertCurrentAuthority() !== undefined
    || storageIdentityDigest(options.ledger.getStorageIdentity()) !== identity) refuse(); elapsed(); };
  live();
  return { live, start, restrict: (lowerDeadlineMs: number) => {
    if (!Number.isSafeInteger(lowerDeadlineMs) || lowerDeadlineMs <= 0 || lowerDeadlineMs > deadlineMs) refuse();
    deadlineMs = lowerDeadlineMs; live(); for (const entry of timers) arm(entry);
  }, close: () => { closed = true; for (const entry of timers) clearTimeout(entry.timer); }, bounded: async <T>(pending: Promise<T>) => {
    let entry!: { timer?: ReturnType<typeof setTimeout>; reject: (error: Error) => void };
    try { const value = await Promise.race([pending, new Promise<never>((_, reject) => {
      entry = { reject }; timers.add(entry); arm(entry);
    })]); live(); return value; } finally { if (entry) { clearTimeout(entry.timer); timers.delete(entry); } }
  } };
}
function bound(options: GatewayFundingReconcilerOptions, assertCurrentAuthority: () => void): GatewayFundingReconcilerOptions {
  return { ledger: options.ledger, terminalStore: options.terminalStore, expectedIdentity: options.expectedIdentity,
    installedPolicyDigest: options.installedPolicyDigest, expectedBackendBindingDigest: options.expectedBackendBindingDigest,
    finalityPolicyDigest: options.finalityPolicyDigest, assertCurrentAuthority };
}
async function operation(options: GatewayFundingReconcilerOptions, operationId: string, live: () => void) {
  live(); const value = await options.ledger.inspectOperation(operationId); live(); if (!value) return null;
  const op = validateGatewayFundingOperation(value), identity = storageIdentityDigest(options.expectedIdentity);
  if (op.operationId !== operationId || storageIdentityDigest(op.policy.identity) !== identity
    || createHash("sha256").update(canonicalJson(op.policy)).digest("hex") !== options.installedPolicyDigest
    || options.finalityPolicyDigest !== GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST) refuse();
  const namespaces = await Promise.all([op.policy.funder, op.policy.spend].map(sender => options.ledger.inspectNamespace(sender))); live();
  for (const [i, value] of namespaces.entries()) {
    const n = validateFundingNamespace(value, options.expectedIdentity, options.expectedBackendBindingDigest);
    if (n.sender !== (i === 0 ? op.policy.funder : op.policy.spend) || n.peer !== (i === 0 ? op.policy.spend : op.policy.funder)
      || n.role !== (i === 0 ? "funder" : "spend") || n.finalityPolicyDigest !== options.finalityPolicyDigest) refuse();
  }
  if (namespaces[0].historyDocumentDigest !== namespaces[1].historyDocumentDigest) refuse();
  if (namespaces[0].limits.nativeWei !== op.policy.lifetimeLimits.nativeWei || namespaces[0].limits.usdcMicros !== op.policy.lifetimeLimits.usdcMicros
    || namespaces[1].limits.depositMicros !== op.policy.lifetimeLimits.depositMicros
    || BigInt(namespaces[0].limits.gasWei) + BigInt(namespaces[1].limits.gasWei) > BigInt(op.policy.lifetimeLimits.gasWei)) refuse();
  return op;
}
async function original(options: GatewayFundingReconcilerOptions, op: Readonly<GatewayFundingOperation>, step: GatewayFundingStep, live: () => void) {
  live(); const saved = await options.ledger.inspectReservation(op.operationId, step); live(); if (!saved) return null;
  if (canonicalJson(validateGatewayFundingOperation(saved.operation)) !== canonicalJson(op)) refuse();
  validatePreparedGatewayFundingTransaction(op, step, saved.transaction.nonce, saved.transaction);
  return saved;
}
function successful(saved: FundingReservationSnapshot | null, op: Readonly<GatewayFundingOperation>, step: GatewayFundingStep) {
  const t = saved?.terminal;
  return !!saved?.prepared && !!saved.cryptoClaimId && !!saved.broadcastClaimId && saved.state === "finalized-success"
    && t?.format === "gateway-funding-terminal-evidence-v1" && t.receiptStatus === "success" && t.operationId === op.operationId && t.step === step
    && t.operationDigest === gatewayFundingReplayDigest(op) && t.identityDigest === storageIdentityDigest(op.policy.identity)
    && canonicalJson(t.identity) === canonicalJson(op.policy.identity) && t.finalityPolicyDigest === GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST
    && t.cryptoClaimId === saved.cryptoClaimId && t.broadcastClaimId === saved.broadcastClaimId
    && t.chainId === "5042002" && t.sender === saved.transaction.sender && t.nonce === saved.transaction.nonce
    && t.transactionHash === saved.prepared.transactionHash && canonicalJson(t.prepared) === canonicalJson(saved.prepared)
    && canonicalJson(saved.prepared.transaction) === canonicalJson(saved.transaction);
}
function compose(options: GatewayFundingReconcilerOptions, keys: Pick<GatewayFundingExecutorOptions, "funderPrivateKey" | "spendPrivateKey"> | null,
  synthetic?: Synthetic, timings: Readonly<GatewayFundingSyntheticTimings> = TIMINGS) {
  if (synthetic) {
    if (!Array.isArray(synthetic.origins) || synthetic.origins.length !== 2) refuse();
    const origins = synthetic.origins.map(endpoint => {
      const url = new URL(endpoint); if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
        || url.username || url.password || url.pathname !== "/" || url.search || url.hash) refuse(); return url.href;
    });
    if (origins[0] === origins[1]) refuse();
    synthetic = Object.freeze({ origins: Object.freeze(origins) as unknown as readonly [string, string], circleEndpoint: synthetic.circleEndpoint });
  }
  const issuer = synthetic ? createGatewayFundingReadinessObserverForTrustedSyntheticComposition(synthetic.circleEndpoint) : observeGatewayFundingReadiness;
  const receipt = synthetic ? createGatewayFundingReceiptObserverForTrustedComposition((endpoint, init) => {
    const index = endpoint === GATEWAY_FUNDING_RECEIPT_POLICY.primary ? 0 : endpoint === GATEWAY_FUNDING_RECEIPT_POLICY.secondary ? 1 : -1;
    if (index !== 0 && index !== 1) refuse(); return nativeFetch(synthetic.origins[index], init);
  }) : undefined;
  const attempts = new Map<string, { promise: Promise<Readonly<GatewayFundingOperationResult>>; settled: boolean }>();
  const finish = (status: GatewayFundingOperationResult["status"], stage: string, step?: GatewayFundingStep, readiness?: Readonly<GatewayFundingReadinessEvidence>) =>
    Object.freeze({ status, stage, ...(step ? { step } : {}), ...(readiness ? { readiness } : {}) });
  async function run(operationId: string, execute: boolean): Promise<Readonly<GatewayFundingOperationResult>> {
    // Each invocation and each phase captures its own guard. No old outstanding
    // action can be revived by rebinding a mutable guard to a newer invocation.
    const life = lifetime(options, execute ? timings.operationDeadlineMs : timings.keylessDeadlineMs), binding = bound(options, life.live);
    let stage = "inspection", step: GatewayFundingStep | undefined;
    let finalReadinessCheck: (() => void) | undefined;
    const pending = (async () => { try {
      // Until mode discovery proves no retained original, every initial read and
      // installed admission shares the shorter deadline from the original start.
      const discovery = lifetime(binding, timings.keylessDeadlineMs, life.start);
      let discovered;
      try { discovered = await discovery.bounded((async () => {
        let op = await operation(binding, operationId, discovery.live);
        if (!op && execute) { stage = "installed-admission"; discovery.live(); await options.ledger.admitOperation(operationId); discovery.live(); op = await operation(binding, operationId, discovery.live); }
        if (!op) return null;
        const initial = await Promise.all(STEPS.map(s => original(binding, op!, s, discovery.live))); discovery.live();
        return { op, initial };
      })()); } finally { discovery.close(); }
      if (!discovered) return finish("missing-operation", stage);
      const { op, initial } = discovered, steps = selected(op);
      for (const [i, s] of STEPS.entries()) if (!steps.includes(s) && initial[i]) refuse();
      const fresh = execute && !initial.some(Boolean);
      if (!fresh) life.restrict(timings.keylessDeadlineMs);
      const reconcile = receipt ? createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition(binding, receipt) : createKeylessGatewayFundingReconciler(binding);
      const execution = fresh && keys ? (synthetic ? createGatewayFundingExecutorForTrustedSyntheticComposition({ ...withoutTerminal(binding), ...keys }, synthetic.origins)
        : createGatewayFundingExecutor({ ...withoutTerminal(binding), ...keys })) : null;
      for (const [index, current] of steps.entries()) {
        step = current; stage = "earlier-originals";
        for (const prior of steps.slice(0, index)) if (!successful(await original(binding, op, prior, life.live), op, prior)) refuse();
        let saved = await original(binding, op, current, life.live);
        if (!saved) {
          if (!execution) return finish("reconciliation-required", "missing-original", current);
          stage = "original-execution"; const sent = await execution.executeStep(operationId, current); life.live();
          if (sent.status !== "broadcast-acknowledged") return finish("reconciliation-required", sent.stage, current);
        }
        // Read-only polling can observe the same original; it grants no new
        // crypto/send claim and never replaces an uncertain nonce or hash.
        stage = "original-receipt"; const phaseLife = lifetime(binding, timings.receiptPhaseDeadlineMs), phase = phaseLife.live, phaseBinding = bound(options, phase);
        const phaseReconcile = receipt ? createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition(phaseBinding, receipt) : createKeylessGatewayFundingReconciler(phaseBinding);
        try { await phaseLife.bounded((async () => { for (let attempt = 0; attempt < (fresh ? 3 : 1); attempt++) {
            phase(); const observed = await (fresh ? phaseReconcile : reconcile).reconcileStep(operationId, current); phase();
            saved = await original(binding, op!, current, phase);
            if (observed.status === "execution-reverted") return;
            if (observed.status === "execution-success" && successful(saved, op!, current)) break;
            if (attempt < (fresh ? 2 : 0)) { await new Promise(resolve => setTimeout(resolve, 1000)); phase(); }
          } })()); } finally { phaseLife.close(); }
        if (saved?.state === "finalized-reverted") return finish("execution-reverted", stage, current);
        if (!successful(saved, op, current)) return finish("reconciliation-required", stage, current);
      }
      stage = "current-availability";
      const exact: GatewayFundingReadinessRequest = { ...withoutTerminal(binding), operationId };
      const token = await issuer(exact); life.live(); if (!token) return finish("reconciliation-required", stage, "deposit");
      const evidence = await unsealVerifiedGatewayFundingReadiness(token, exact); life.live();
      const answer = finish("current-funding-ready", stage, "deposit", evidence);
      finalReadinessCheck = () => assertVerifiedGatewayFundingReadinessCurrent(token, exact); return answer;
    } catch { return finish("reconciliation-required", stage, step); } })();
    try { const answer = await life.bounded(pending);
      if (answer.status === "current-funding-ready") { if (!finalReadinessCheck) refuse(); finalReadinessCheck(); }
      return answer; }
    catch { return finish("reconciliation-required", stage, step); }
    finally { life.close(); }
  }
  return Object.freeze({ runOperation(operationId: string): Promise<Readonly<GatewayFundingOperationResult>> {
    if (typeof operationId !== "string" || !UUID.test(operationId)) refuse();
    const prior = attempts.get(operationId);
    if (prior && !prior.settled) return prior.promise;
    if (!keys || prior) return run(operationId, false).catch(() => finish("reconciliation-required", "binding"));
    const entry = { promise: run(operationId, true).catch(() => finish("reconciliation-required", "binding")), settled: false }; attempts.set(operationId, entry);
    void entry.promise.then(() => { entry.settled = true; }, () => { entry.settled = true; }); return entry.promise;
  } });
}
function withoutTerminal(options: GatewayFundingReconcilerOptions) {
  const { terminalStore: _terminal, ...binding } = options; return binding;
}
export function createGatewayFundingOrchestrator(options: GatewayFundingOrchestratorOptions) {
  shape(options, [...BINDING, "funderPrivateKey", "spendPrivateKey"]);
  const { funderPrivateKey, spendPrivateKey, ...binding } = options; return compose(binding, { funderPrivateKey, spendPrivateKey });
}
export function createKeylessGatewayFundingOrchestrator(options: GatewayFundingReconcilerOptions) {
  shape(options, BINDING); return compose({ ...options }, null);
}
export function createGatewayFundingOrchestratorForTrustedSyntheticComposition(options: GatewayFundingOrchestratorOptions, synthetic: Synthetic, timings?: Readonly<GatewayFundingSyntheticTimings>) {
  shape(options, [...BINDING, "funderPrivateKey", "spendPrivateKey"]); shape(synthetic, ["origins", "circleEndpoint"]);
  const { funderPrivateKey, spendPrivateKey, ...binding } = options; return compose(binding, { funderPrivateKey, spendPrivateKey }, synthetic, syntheticTimings(timings));
}
export function createKeylessGatewayFundingOrchestratorForTrustedSyntheticComposition(options: GatewayFundingReconcilerOptions, synthetic: Synthetic, timings?: Readonly<GatewayFundingSyntheticTimings>) {
  shape(options, BINDING); shape(synthetic, ["origins", "circleEndpoint"]); return compose({ ...options }, null, synthetic, syntheticTimings(timings));
}

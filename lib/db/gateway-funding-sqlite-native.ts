import { fstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { unsealVerifiedGatewayFundingReceipt } from "../payments/gateway-funding-receipt-observer";
import { gatewayFundingReplayDigest, reserveFundingExposure, validateGatewayFundingOperation } from "../payments/gateway-funding-policy";
import { prepareGatewayFundingTransaction, validatePreparedGatewayFundingTransaction, validateSignedGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, installStorageFences, registerStorageCapability, restrictStorageApplicationSql } from "./storage-identity-sqlite";
import { scanFullStorageSnapshot, STORAGE_SNAPSHOT_LIMITS } from "./storage-identity-snapshot";
import { assertGatewayFundingSchema, GATEWAY_FUNDING_SCHEMA } from "./gateway-funding-sqlite-schema";
import { FUNDING_ZERO, fundingAggregate, fundingAddress, fundingDigest, fundingJson, fundingNonce, fundingRecord, fundingRefused,
  fundingStep, fundingSum, fundingUint, fundingUuid, readFundingJson, validateFundingNamespace, validateFundingOwnerInstallation } from "./gateway-funding-ledger-validation";
import type { FundingCandidateObservation, FundingNamespaceSnapshot, FundingOwnerInstallation, FundingReservationSnapshot,
  FundingTerminalEvidence, GatewayFundingTerminalObserverStore, VerifiedFundingTerminalObservation, GatewayFundingLedger, GatewayFundingStep } from "./gateway-funding-ledger-types";

type Scope = "owner" | "authorization" | "admit" | "reserve" | "crypto" | "prepared" | "broadcast" | "candidate" | "terminal";
const WRITES: Record<Scope, readonly string[]> = {
  owner: ["gateway_funding_namespaces:INSERT", "gateway_funding_policies:INSERT"],
  authorization: ["gateway_funding_authorizations:INSERT"],
  admit: ["gateway_funding_operations:INSERT", "gateway_funding_namespaces:UPDATE"],
  reserve: ["gateway_funding_reservations:INSERT", "gateway_funding_namespaces:UPDATE"],
  crypto: ["gateway_funding_crypto_claims:INSERT"], prepared: ["gateway_funding_prepared:INSERT"],
  broadcast: ["gateway_funding_broadcast_claims:INSERT"], candidate: ["gateway_funding_observations:INSERT"],
  terminal: ["gateway_funding_observations:INSERT", "terminal-observer:INSERT"],
};
const observers = new WeakMap<GatewayFundingLedger, GatewayFundingTerminalObserverStore>();
/** Private native context, never returned to app callers. Generic identity-bound
 * writers do not possess this connection-local domain operation capability. */
function connection(file: string, expected: StorageIdentity, owner = false, readOnly = false) {
  const identity = validateStorageIdentity(expected), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined, closed = false, scope: Scope | undefined;
  const close = () => { if (!closed) { closed = true; scope = undefined; try { db?.close(); } finally { held.close(); } } };
  try {
    if (identity.authorityMode !== "testnet-real" || fstatSync(held.descriptor).size > STORAGE_SNAPSHOT_LIMITS.fileBytes) fundingRefused();
    db = new DatabaseSync(file, { readOnly, allowExtension: false });
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    if (!owner) assertGatewayFundingSchema(db);
    db.exec("PRAGMA busy_timeout=5000"); if (!readOnly) db.exec("PRAGMA synchronous=FULL");
    registerStorageCapability(db, identity, () => !closed);
    db.function("keryx_funding_capability", { deterministic: false }, (table, verb) =>
      !closed && scope !== undefined && WRITES[scope].includes(`${table}:${verb}`) ? 1 : 0);
    if (!owner) restrictStorageApplicationSql(db);
  } catch { close(); return fundingRefused(); }
  const native = db;
  const assert = () => {
    if (closed) fundingRefused(); held.verify(); assertStorageIdentity(native, identity); assertStorageFences(native, identity);
    if (!owner) assertGatewayFundingSchema(native);
  };
  const atomic = <T>(selected: Scope, action: () => T): T => {
    try { assert(); if (readOnly || scope !== undefined) fundingRefused();
      native.exec("BEGIN IMMEDIATE"); scope = selected;
      assert(); const result = action(); assert(); scope = undefined; native.exec("COMMIT"); held.verify(); return result; }
    catch { scope = undefined; try { native.exec("ROLLBACK"); } catch {} return fundingRefused(); }
    finally { scope = undefined; }
  };
  function data(table: string, column: string, id: string) {
    assert(); const row = native.prepare(`SELECT CASE WHEN length(CAST(data AS BLOB))<=32768 THEN data ELSE NULL END AS data FROM ${table} WHERE ${column}=?`).get(id);
    return row ? readFundingJson(row.data) : null;
  }
  function namespace(sender: string): Readonly<FundingNamespaceSnapshot> {
    const row = data("gateway_funding_namespaces", "sender", fundingAddress(sender));
    if (!row) fundingRefused(); return validateFundingNamespace(row, identity, held.identity);
  }
  return { db: native, identity, backendDigest: held.identity, assert, atomic, data, namespace, close };
}

/** Internal trusted-native entry used by the bounded owner child only.
 * Keyless provenance/CAS evidence never grants signing-resume authorization.
 * Path/dev/inode/birth binding detects ordinary new-file/path copies; trusted
 * filesystem integrity remains required against in-place or host-image rollback. */
export function inspectGatewayFundingSqliteOwnerTarget(file: string, identity: StorageIdentity) {
  const c = connection(file, identity, true, true);
  try { c.db.exec("BEGIN"); c.assert(); const snapshot = scanFullStorageSnapshot(c.db); c.assert(); c.db.exec("ROLLBACK");
    return Object.freeze({ reviewedTargetDigest: c.backendDigest, reviewedSnapshotDigest: snapshot.snapshotDigest });
  } finally { c.close(); }
}
function namespaceFor(installation: Readonly<FundingOwnerInstallation>, role: "funder" | "spend", backendDigest: string): Readonly<FundingNamespaceSnapshot> {
  const { policy } = installation, funder = role === "funder";
  const limits = Object.freeze({ nativeWei: funder ? policy.lifetimeLimits.nativeWei : "0", usdcMicros: funder ? policy.lifetimeLimits.usdcMicros : "0",
    depositMicros: funder ? "0" : policy.lifetimeLimits.depositMicros, gasWei: funder ? installation.funderGasBudgetWei : installation.spendGasBudgetWei });
  return Object.freeze({ identityDigest: storageIdentityDigest(policy.identity), chainId: "5042002", sender: funder ? policy.funder : policy.spend,
    peer: funder ? policy.spend : policy.funder, role, historyDocumentDigest: installation.history.documentDigest,
    backendBindingDigest: backendDigest, finalityPolicyDigest: installation.finalityPolicyDigest, initialNonce: "0", nextNonce: "0",
    limits, used: FUNDING_ZERO, nativeAggregateLimitWei: fundingAggregate(limits), nativeAggregateUsedWei: "0" });
}
function namespaceOriginal(namespace: Readonly<FundingNamespaceSnapshot>) {
  return { ...namespace, used: FUNDING_ZERO, nextNonce: "0", nativeAggregateUsedWei: "0" };
}
/** Separate trusted OWNER control-plane entrypoint. Not called by adapter init,
 * application admission, HTTP input or normal DAL. Empty isolated key history is
 * owner-reviewed evidence, not something an RPC nonce or this library proves. */
export function installGatewayFundingSqliteOwnerPolicy(file: string, identity: StorageIdentity, input: unknown) {
  const installation = validateFundingOwnerInstallation(input), c = connection(file, identity, true);
  try {
    if (storageIdentityDigest(installation.policy.identity) !== storageIdentityDigest(c.identity)
      || installation.reviewedTargetDigest !== c.backendDigest) fundingRefused();
    return c.atomic("owner", () => {
      const exists = c.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='gateway_funding_policies'").get();
      if (exists) {
        assertGatewayFundingSchema(c.db); const original = c.data("gateway_funding_policies", "policy_id", installation.policy.policyId);
        if (original) { if (fundingJson(original) !== fundingJson(installation)) fundingRefused(); return Object.freeze({ installed: false }); }
      }
      if (scanFullStorageSnapshot(c.db).snapshotDigest !== installation.reviewedSnapshotDigest) fundingRefused();
      if (!exists) {
        // Conservatively refuse known existing authority for either proposed key.
        const keys = [installation.policy.funder, installation.policy.spend];
        for (const [table, column] of [["payment_events", "payer"], ["withdrawals", "wallet"], ["session_grants", "sess_addr"],
          ["browser_signer_capacity", "signer"], ["private_treasury_pools", "signer"]]) {
          if (c.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)
            && c.db.prepare(`SELECT 1 FROM ${table} WHERE lower(${column}) IN (?,?) LIMIT 1`).get(...keys)) fundingRefused();
        }
        for (const sql of Object.values(GATEWAY_FUNDING_SCHEMA)) c.db.exec(sql);
        installStorageFences(c.db, c.identity); assertGatewayFundingSchema(c.db);
      }
      for (const role of ["funder", "spend"] as const) {
        const proposed = namespaceFor(installation, role, c.backendDigest), original = c.data("gateway_funding_namespaces", "sender", proposed.sender);
        if (original) {
          if (fundingJson(namespaceOriginal(c.namespace(proposed.sender))) !== fundingJson(proposed)) fundingRefused();
        } else {
          c.db.prepare("INSERT INTO gateway_funding_namespaces(sender,data) VALUES(?,?)").run(proposed.sender, fundingJson(proposed));
        }
      }
      c.db.prepare("INSERT INTO gateway_funding_policies(policy_id,data) VALUES(?,?)").run(installation.policy.policyId, fundingJson(installation));
      return Object.freeze({ installed: true });
    });
  } finally { c.close(); }
}
/** Explicit owner authorization installation. The app API accepts only its ID,
 * never a caller policy/amount/document digest as authority. Issuer integration
 * and real/shared-key migration remain reviewed rollout gates. */
export function installGatewayFundingSqliteOwnerAuthorization(file: string, identity: StorageIdentity, input: unknown) {
  const operation = validateGatewayFundingOperation(input), c = connection(file, identity, true);
  try { return c.atomic("authorization", () => {
    const installed = c.data("gateway_funding_policies", "policy_id", operation.policy.policyId);
    if (!installed) fundingRefused(); const policy = validateFundingOwnerInstallation(installed);
    c.namespace(policy.policy.funder); c.namespace(policy.policy.spend);
    if (fundingJson(policy.policy) !== fundingJson(operation.policy)) fundingRefused();
    const original = c.data("gateway_funding_authorizations", "operation_id", operation.operationId);
    if (original) { if (gatewayFundingReplayDigest(original) !== gatewayFundingReplayDigest(operation)) fundingRefused(); return Object.freeze({ installed: false }); }
    c.db.prepare("INSERT INTO gateway_funding_authorizations(operation_id,owner_authorization_id,data) VALUES(?,?,?)")
      .run(operation.operationId, operation.ownerAuthorizationId, fundingJson(operation));
    return Object.freeze({ installed: true });
  }); } finally { c.close(); }
}

export function openGatewayFundingSqliteLedger(file: string, expected: StorageIdentity, options: { readOnly?: boolean } = {}): GatewayFundingLedger {
  const c = connection(file, expected, false, options.readOnly ?? false);
  try {
    const rows = c.db.prepare("SELECT CASE WHEN length(sender)=42 THEN sender ELSE NULL END AS sender FROM gateway_funding_namespaces").iterate();
    let count = 0;
    for (const row of rows) { if (++count > 1024) fundingRefused(); c.namespace(fundingAddress(row.sender)); }
    if (!count) fundingRefused();
  } catch { c.close(); return fundingRefused(); }
  function operation(id: string) {
    const data = c.data("gateway_funding_operations", "operation_id", fundingUuid(id));
    if (!data) return null;
    const value = validateGatewayFundingOperation(data);
    if (value.operationId !== id || storageIdentityDigest(value.policy.identity) !== storageIdentityDigest(c.identity)) fundingRefused();
    const installed = c.data("gateway_funding_policies", "policy_id", value.policy.policyId); if (!installed) fundingRefused();
    const policy = validateFundingOwnerInstallation(installed);
    if (fundingJson(policy.policy) !== fundingJson(value.policy)) fundingRefused();
    c.namespace(value.policy.funder); c.namespace(value.policy.spend); return value;
  }
  function reservation(id: string, step: GatewayFundingStep) {
    const op = operation(fundingUuid(id)); fundingStep(step); if (!op) fundingRefused();
    const row = c.db.prepare("SELECT sender,nonce,CASE WHEN length(CAST(data AS BLOB))<=32768 THEN data ELSE NULL END AS data FROM gateway_funding_reservations WHERE operation_id=? AND step=?").get(id, step);
    if (!row) return null;
    const transaction = validatePreparedGatewayFundingTransaction(op, step, fundingNonce(row.nonce), readFundingJson(row.data));
    if (transaction.sender !== row.sender) fundingRefused(); return { operation: op, transaction };
  }
  async function inspect(id: string, step: GatewayFundingStep): Promise<Readonly<FundingReservationSnapshot> | null> {
    c.assert(); const value = reservation(id, step); if (!value) return null;
    const crypto = c.db.prepare("SELECT claim_id FROM gateway_funding_crypto_claims WHERE operation_id=? AND step=?").get(id, step);
    const saved = c.db.prepare("SELECT crypto_claim_id,transaction_hash,CASE WHEN length(CAST(data AS BLOB))<=32768 THEN data ELSE NULL END AS data FROM gateway_funding_prepared WHERE operation_id=? AND step=?").get(id, step);
    const broadcast = c.db.prepare("SELECT claim_id FROM gateway_funding_broadcast_claims WHERE operation_id=? AND step=?").get(id, step);
    let prepared;
    if (saved) {
      if (!crypto || saved.crypto_claim_id !== crypto.claim_id) fundingRefused();
      const raw = readFundingJson(saved.data) as { rawTransaction?: unknown; transactionHash?: unknown };
      prepared = await validateSignedGatewayFundingTransaction(value.operation, step, value.transaction.nonce,
        { rawTransaction: raw.rawTransaction, transactionHash: raw.transactionHash }, c.assert);
      if (fundingJson(prepared) !== fundingJson(raw) || prepared.transactionHash !== saved.transaction_hash) fundingRefused();
    }
    if (broadcast && !prepared) fundingRefused();
    c.assert();
    const terminalData = c.data("gateway_funding_observations", "observation_id", `${id}:${step}:terminal`);
    let terminal: Readonly<FundingTerminalEvidence> | undefined;
    if (terminalData) {
      if (!prepared || !crypto || !broadcast) fundingRefused();
      const r = fundingRecord(terminalData, ["format", "identity", "identityDigest", "operationDigest", "operationId", "step", "transactionHash",
        "cryptoClaimId", "broadcastClaimId", "prepared", "sender", "nonce", "chainId", "receiptStatus", "blockNumber", "blockHash",
        "gasUsed", "effectiveGasPriceWei", "observedAt", "finalityPolicyDigest", "finalizedBlockNumber", "finalizedBlockHash", "providerEvidenceDigest"]);
      const ns = c.namespace(value.transaction.sender);
      if (r.format !== "gateway-funding-terminal-evidence-v1" || fundingJson(r.identity) !== fundingJson(c.identity)
        || r.identityDigest !== storageIdentityDigest(c.identity) || r.operationDigest !== gatewayFundingReplayDigest(value.operation)
        || r.operationId !== id || r.step !== step || r.transactionHash !== prepared.transactionHash || r.cryptoClaimId !== crypto.claim_id
        || r.broadcastClaimId !== broadcast.claim_id || fundingJson(r.prepared) !== fundingJson(prepared) || r.sender !== value.transaction.sender
        || r.nonce !== value.transaction.nonce || r.chainId !== "5042002" || r.finalityPolicyDigest !== ns.finalityPolicyDigest
        || r.receiptStatus !== "success" && r.receiptStatus !== "reverted") fundingRefused();
      const blockNumber = fundingUint(r.blockNumber), finalizedBlockNumber = fundingUint(r.finalizedBlockNumber);
      const gasUsed = fundingUint(r.gasUsed), effectiveGasPriceWei = fundingUint(r.effectiveGasPriceWei);
      if (BigInt(finalizedBlockNumber) < BigInt(blockNumber) || BigInt(gasUsed) > BigInt(value.transaction.gas)
        || BigInt(effectiveGasPriceWei) > BigInt(value.transaction.maxFeePerGasWei)
        || typeof r.blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(r.blockHash)
        || typeof r.finalizedBlockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(r.finalizedBlockHash)
        || typeof r.observedAt !== "string" || !Number.isFinite(Date.parse(r.observedAt)) || new Date(r.observedAt).toISOString() !== r.observedAt) fundingRefused();
      fundingDigest(r.providerEvidenceDigest);
      terminal = Object.freeze({ ...r, identity: c.identity, prepared }) as unknown as Readonly<FundingTerminalEvidence>;
    }
    const unknown = c.db.prepare("SELECT 1 FROM gateway_funding_observations WHERE operation_id=? AND step=? AND kind='unknown' LIMIT 1").get(id, step);
    return Object.freeze({ ...value, state: terminal ? terminal.receiptStatus === "success" ? "finalized-success" : "finalized-reverted" : unknown ? "unresolved" : broadcast ? "pending" : prepared ? "prepared" : crypto ? "crypto-claimed" : "reserved",
      ...(terminal ? { terminal } : {}),
      ...(crypto ? { cryptoClaimId: fundingUuid(crypto.claim_id) } : {}), ...(prepared ? { prepared } : {}),
      ...(broadcast ? { broadcastClaimId: fundingUuid(broadcast.claim_id) } : {}) });
  }
  const earlier = async (sender: string, nonce: string) => {
    for (const row of c.db.prepare("SELECT operation_id,step FROM gateway_funding_reservations WHERE sender=? AND CAST(nonce AS INTEGER)<?").iterate(sender, Number(nonce))) {
      const prior = await inspect(fundingUuid(row.operation_id), fundingStep(row.step));
      if (!prior?.terminal) fundingRefused();
    }
  };
  async function claim(id: string, step: GatewayFundingStep, claimId: string, broadcast: boolean) {
    fundingUuid(claimId); const initial = await inspect(id, step); if (!initial) fundingRefused();
    await earlier(initial.transaction.sender, initial.transaction.nonce);
    const table = broadcast ? "gateway_funding_broadcast_claims" : "gateway_funding_crypto_claims";
    const fresh = c.atomic(broadcast ? "broadcast" : "crypto", () => {
      const current = reservation(id, step); if (!current || fundingJson(current.transaction) !== fundingJson(initial.transaction)) fundingRefused();
      const original = c.db.prepare(`SELECT claim_id FROM ${table} WHERE operation_id=? AND step=?`).get(id, step);
      if (original) { if (original.claim_id !== claimId) fundingRefused(); return false; }
      // Protected terminal rows are immutable; the preflight validated every
      // earlier original. The namespace and original slot are rechecked here.
      if (broadcast && (!initial.prepared || !initial.cryptoClaimId)) fundingRefused();
      c.db.prepare(`INSERT INTO ${table}(operation_id,step,claim_id) VALUES(?,?,?)`).run(id, step, claimId); return true;
    });
    const saved = await inspect(id, step); if (!saved || (broadcast ? saved.broadcastClaimId : saved.cryptoClaimId) !== claimId) fundingRefused();
    return Object.freeze({ fresh, claimId, reservation: saved });
  }
  const ledger: GatewayFundingLedger = Object.freeze({
    getStorageIdentity: () => { c.assert(); return c.identity; }, close: c.close,
    inspectNamespace: async (sender: string) => { c.assert(); return c.namespace(sender); },
    inspectOperation: async (id: string) => { c.assert(); return operation(id); },
    admitOperation: async (id: string) => c.atomic("admit", () => {
      fundingUuid(id); const original = operation(id); if (original) return original;
      const authorized = c.data("gateway_funding_authorizations", "operation_id", id); if (!authorized) fundingRefused();
      const op = validateGatewayFundingOperation(authorized); if (op.operationId !== id) fundingRefused();
      const installed = c.data("gateway_funding_policies", "policy_id", op.policy.policyId); if (!installed) fundingRefused();
      const policy = validateFundingOwnerInstallation(installed); if (fundingJson(policy.policy) !== fundingJson(op.policy)) fundingRefused();
      const fee = BigInt(op.maxFeePerGasWei);
      for (const [sender, requested] of [[op.policy.funder, { nativeWei: op.nativeTransferWei, usdcMicros: op.usdcTransferMicros, depositMicros: "0",
        gasWei: ((BigInt(op.gasLimits.nativeTransfer) + BigInt(op.gasLimits.usdcTransfer)) * fee).toString() }],
      [op.policy.spend, { nativeWei: "0", usdcMicros: "0", depositMicros: op.depositMicros,
        gasWei: ((BigInt(op.gasLimits.approval) + BigInt(op.gasLimits.deposit)) * fee).toString() }]] as const) {
        const ns = c.namespace(sender), used = reserveFundingExposure(ns.limits, ns.used, requested);
        const updated = { ...ns, used, nativeAggregateUsedWei: fundingAggregate(used) };
        c.db.prepare("UPDATE gateway_funding_namespaces SET data=? WHERE sender=?").run(fundingJson(updated), sender);
      }
      c.db.prepare("INSERT INTO gateway_funding_operations(operation_id,data) VALUES(?,?)").run(id, fundingJson(op)); return op;
    }),
    reserveStep: async (id: string, step: GatewayFundingStep, originalNonce: string) => {
      fundingUuid(id); fundingStep(step); fundingNonce(originalNonce);
      c.atomic("reserve", () => {
        const op = operation(id); if (!op) fundingRefused(); const transaction = prepareGatewayFundingTransaction(op, step, originalNonce);
        const original = reservation(id, step); if (original) { if (fundingJson(original.transaction) !== fundingJson(transaction)) fundingRefused(); return; }
        const ns = c.namespace(transaction.sender); if (ns.nextNonce !== originalNonce) fundingRefused();
        c.db.prepare("INSERT INTO gateway_funding_reservations(operation_id,step,sender,nonce,data) VALUES(?,?,?,?,?)")
          .run(id, step, transaction.sender, originalNonce, fundingJson(transaction));
        c.db.prepare("UPDATE gateway_funding_namespaces SET data=? WHERE sender=?")
          .run(fundingJson({ ...ns, nextNonce: (BigInt(originalNonce) + BigInt(1)).toString() }), transaction.sender);
      });
      const saved = await inspect(id, step); if (!saved) fundingRefused(); return saved;
    },
    inspectReservation: inspect,
    claimCrypto: (id: string, step: GatewayFundingStep, claimId: string) => claim(id, step, claimId, false),
    claimBroadcast: (id: string, step: GatewayFundingStep, claimId: string) => claim(id, step, claimId, true),
    savePrepared: async (id: string, step: GatewayFundingStep, cryptoClaimId: string, input: Readonly<{ rawTransaction: string; transactionHash: string }>) => {
      fundingUuid(cryptoClaimId); const original = await inspect(id, step); if (!original || original.cryptoClaimId !== cryptoClaimId) fundingRefused();
      const prepared = await validateSignedGatewayFundingTransaction(original.operation, step, original.transaction.nonce, input, c.assert);
      c.atomic("prepared", () => {
        const slot = reservation(id, step), claimed = c.db.prepare("SELECT claim_id FROM gateway_funding_crypto_claims WHERE operation_id=? AND step=?").get(id, step);
        if (!slot || claimed?.claim_id !== cryptoClaimId || fundingJson(slot.transaction) !== fundingJson(original.transaction)) fundingRefused();
        const saved = c.db.prepare("SELECT data FROM gateway_funding_prepared WHERE operation_id=? AND step=?").get(id, step);
        if (saved) { if (saved.data !== fundingJson(prepared)) fundingRefused(); return; }
        c.db.prepare("INSERT INTO gateway_funding_prepared(operation_id,step,crypto_claim_id,transaction_hash,data) VALUES(?,?,?,?,?)")
          .run(id, step, cryptoClaimId, prepared.transactionHash, fundingJson(prepared));
      });
      const saved = await inspect(id, step); if (!saved?.prepared || fundingJson(saved.prepared) !== fundingJson(prepared)) fundingRefused(); return saved;
    },
    appendCandidateObservation: async (input: FundingCandidateObservation) => {
      const r = fundingRecord(input, ["format", "observationId", "operationId", "step", "transactionHash", "status", "observedAt", "evidenceDigest"]);
      if (r.format !== "gateway-funding-candidate-observation-v1" || typeof r.status !== "string" || !["seen", "unknown"].includes(r.status)
        || typeof r.observedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.observedAt)
        || !Number.isFinite(Date.parse(r.observedAt)) || new Date(r.observedAt).toISOString() !== r.observedAt) fundingRefused();
      const observation: Readonly<FundingCandidateObservation> = Object.freeze({ format: r.format, observationId: fundingUuid(r.observationId), operationId: fundingUuid(r.operationId),
        step: fundingStep(r.step), transactionHash: typeof r.transactionHash === "string" && /^0x[0-9a-f]{64}$/.test(r.transactionHash) ? r.transactionHash : fundingRefused(), status: r.status as "seen" | "unknown", observedAt: r.observedAt,
        evidenceDigest: fundingDigest(r.evidenceDigest) });
      const slot = await inspect(observation.operationId, observation.step);
      if (!slot?.prepared || !slot.broadcastClaimId || observation.transactionHash !== slot.prepared.transactionHash) fundingRefused();
      c.atomic("candidate", () => {
        const previous = c.data("gateway_funding_observations", "observation_id", observation.observationId);
        if (previous) { if (fundingJson(previous) !== fundingJson(observation)) fundingRefused(); return; }
        c.db.prepare("INSERT INTO gateway_funding_observations(observation_id,operation_id,step,kind,data) VALUES(?,?,?,?,?)")
          .run(observation.observationId, observation.operationId, observation.step, observation.status, fundingJson(observation));
      }); return observation;
    },
  });
  observers.set(ledger, { appendVerifiedTerminalObservation: async (id: string, step: GatewayFundingStep, token: VerifiedFundingTerminalObservation) => {
    fundingUuid(id); fundingStep(step); const original = await inspect(id, step);
    if (!original?.prepared || !original.cryptoClaimId || !original.broadcastClaimId) fundingRefused();
    const finalityPolicyDigest = c.namespace(original.transaction.sender).finalityPolicyDigest;
    const evidence = unsealVerifiedGatewayFundingReceipt(token, { operation: original.operation, prepared: original.prepared,
      cryptoClaimId: original.cryptoClaimId, broadcastClaimId: original.broadcastClaimId, finalityPolicyDigest }, c.assert);
    c.atomic("terminal", () => {
      const current = reservation(id, step); if (!current || fundingJson(current.transaction) !== fundingJson(original.transaction)) fundingRefused();
      c.namespace(current.transaction.sender);
      const prepared = c.data("gateway_funding_prepared", "transaction_hash", original.prepared!.transactionHash);
      const crypto = c.db.prepare("SELECT claim_id FROM gateway_funding_crypto_claims WHERE operation_id=? AND step=?").get(id, step);
      const broadcast = c.db.prepare("SELECT claim_id FROM gateway_funding_broadcast_claims WHERE operation_id=? AND step=?").get(id, step);
      if (fundingJson(prepared) !== fundingJson(original.prepared) || crypto?.claim_id !== original.cryptoClaimId || broadcast?.claim_id !== original.broadcastClaimId) fundingRefused();
      const observationId = `${id}:${step}:terminal`, previous = c.data("gateway_funding_observations", "observation_id", observationId);
      if (previous) { if (fundingJson(previous) !== fundingJson(evidence)) fundingRefused(); return; }
      c.db.prepare("INSERT INTO gateway_funding_observations(observation_id,operation_id,step,kind,data) VALUES(?,?,?,'terminal',?)").run(observationId, id, step, fundingJson(evidence));
    });
  } });
  return ledger;
}
/** Controlled observer composition only; no generic app DAL finality API. */
export function openGatewayFundingSqliteTerminalObserver(file: string, expected: StorageIdentity) {
  const ledger = openGatewayFundingSqliteLedger(file, expected), observer = observers.get(ledger)!;
  return Object.freeze({ appendVerifiedTerminalObservation: observer.appendVerifiedTerminalObservation, close: ledger.close });
}

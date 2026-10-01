import type { GatewayFundingLedger, GatewayFundingStep, FundingNamespaceSnapshot, FundingReservationSnapshot, FundingClaimResult, FundingCandidateObservation } from "./gateway-funding-ledger-types";
import { SupabaseAuthority } from "./supabase-authority";
import { storageIdentityDigest } from "./storage-identity";
import { validateGatewayFundingOperation, gatewayFundingReplayDigest as gatewayFundingOperationDigest, type GatewayFundingOperation } from "../payments/gateway-funding-policy";
import { prepareGatewayFundingTransaction, validatePreparedGatewayFundingTransaction, validateSignedGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { fundingRecord, validateFundingNamespace } from "./gateway-funding-ledger-validation";
import { canonicalJson } from "../canonical-json";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const STATES = new Set(["reserved", "crypto-claimed", "prepared", "broadcast-claimed", "pending", "unresolved", "finalized-success", "finalized-reverted"]);
function refuse(): never { throw new Error("Gateway funding ledger refused"); }
function uuid(value: string): void { if (typeof value !== "string" || !UUID.test(value)) refuse(); }
function step(value: GatewayFundingStep): void { if (!["nativeTransfer", "usdcTransfer", "approval", "deposit"].includes(value)) refuse(); }
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !("value" in d))) refuse();
  return input as Record<string, unknown>;
}

function uint(input: unknown): string { if (typeof input !== "string" || !UINT.test(input) || BigInt(input) > MAX) refuse(); return input; }
function freeze<T>(input: T): Readonly<T> {
  if (input && typeof input === "object") { for (const item of Object.values(input)) freeze(item); Object.freeze(input); }
  return input;
}

/** Application plane only. Owner installation and protected terminal observation
 * are deliberately absent. Every named SQL call repeats full identity/native
 * target admission inside its transaction; configured metadata is not adoption. */
export class SupabaseGatewayFundingLedger implements GatewayFundingLedger {
  private closed = false;
  private readonly identityDigest: string;
  constructor(private readonly authority: SupabaseAuthority) {
    const identity = authority.getStorageIdentity();
    if (identity.authorityMode !== "testnet-real") refuse();
    this.identityDigest = storageIdentityDigest(identity);
  }
  private guard = (): void => {
    if (this.closed || storageIdentityDigest(this.authority.getStorageIdentity()) !== this.identityDigest) refuse();
  };
  getStorageIdentity() { this.guard(); return this.authority.getStorageIdentity(); }
  close(): void { this.closed = true; }
  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.guard();
    try {
      const result = await this.authority.rpc(`funding_${name}`, args);
      this.guard(); if (result.error) refuse(); return result.data;
    } catch { refuse(); }
  }
  private operation(input: unknown, operationId: string): Readonly<GatewayFundingOperation> {
    const operation = validateGatewayFundingOperation(input);
    if (operation.operationId !== operationId || storageIdentityDigest(operation.policy.identity) !== this.identityDigest) refuse();
    return operation;
  }
  private async snapshot(input: unknown, operationId: string, selectedStep: GatewayFundingStep): Promise<Readonly<FundingReservationSnapshot>> {
    const value = record(input); const operation = this.operation(value.operation, operationId);
    fundingRecord(value, ["operation", "transaction", "state", ...["cryptoClaimId", "prepared", "broadcastClaimId", "terminal"].filter(key => Object.hasOwn(value, key))]);
    const transaction = record(value.transaction);
    const nonce = uint(transaction.nonce);
    const validated = validatePreparedGatewayFundingTransaction(operation, selectedStep, nonce, value.transaction);
    if (typeof value.state !== "string" || !STATES.has(value.state)) refuse();
    const result: FundingReservationSnapshot = { operation, transaction: validated, state: value.state as FundingReservationSnapshot["state"] };
    if (value.cryptoClaimId !== undefined) { uuid(value.cryptoClaimId as string); Object.assign(result, { cryptoClaimId: value.cryptoClaimId }); }
    if (value.broadcastClaimId !== undefined) { uuid(value.broadcastClaimId as string); Object.assign(result, { broadcastClaimId: value.broadcastClaimId }); }
    if (value.prepared !== undefined) {
      const prepared = record(value.prepared);
      fundingRecord(prepared, ["format", "transaction", "rawTransaction", "transactionHash"]);
      if (prepared.format !== "gateway-funding-signed-transaction-v1"
        || typeof prepared.rawTransaction !== "string" || !/^0x02[0-9a-f]+$/.test(prepared.rawTransaction) || prepared.rawTransaction.length > 4098
        || typeof prepared.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/.test(prepared.transactionHash)) refuse();
      const signed = await validateSignedGatewayFundingTransaction(operation, selectedStep, nonce,
        { rawTransaction: prepared.rawTransaction, transactionHash: prepared.transactionHash }, this.guard);
      validatePreparedGatewayFundingTransaction(operation, selectedStep, nonce, prepared.transaction);
      Object.assign(result, { prepared: signed });
    }
    if (value.terminal !== undefined) {
      const terminal = fundingRecord(value.terminal, ["format", "identity", "identityDigest", "operationDigest", "operationId", "step", "transactionHash",
        "cryptoClaimId", "broadcastClaimId", "prepared", "sender", "nonce", "chainId", "receiptStatus", "blockNumber", "blockHash", "gasUsed",
        "effectiveGasPriceWei", "observedAt", "finalityPolicyDigest", "finalizedBlockNumber", "finalizedBlockHash", "providerEvidenceDigest"]);
      if (!result.prepared || !result.cryptoClaimId || !result.broadcastClaimId || terminal.format !== "gateway-funding-terminal-evidence-v1"
        || canonicalJson(terminal.identity) !== canonicalJson(operation.policy.identity) || terminal.identityDigest !== this.identityDigest
        || terminal.operationDigest !== gatewayFundingOperationDigest(operation) || terminal.operationId !== operationId || terminal.step !== selectedStep
        || terminal.transactionHash !== result.prepared.transactionHash || terminal.cryptoClaimId !== result.cryptoClaimId
        || terminal.broadcastClaimId !== result.broadcastClaimId || canonicalJson(terminal.prepared) !== canonicalJson(result.prepared)
        || terminal.sender !== validated.sender || terminal.nonce !== nonce || terminal.chainId !== "5042002"
        || !["success", "reverted"].includes(terminal.receiptStatus as string)
        || value.state !== `finalized-${terminal.receiptStatus}`
        || BigInt(uint(terminal.gasUsed)) > BigInt(validated.gas) || BigInt(uint(terminal.effectiveGasPriceWei)) > BigInt(validated.maxFeePerGasWei)
        || BigInt(uint(terminal.finalizedBlockNumber)) < BigInt(uint(terminal.blockNumber))) refuse();
      for (const key of ["blockHash", "finalizedBlockHash"]) if (typeof terminal[key] !== "string" || !/^0x[0-9a-f]{64}$/.test(terminal[key] as string)) refuse();
      for (const key of ["finalityPolicyDigest", "providerEvidenceDigest"]) if (typeof terminal[key] !== "string" || !/^[0-9a-f]{64}$/.test(terminal[key] as string)) refuse();
      if (typeof terminal.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(terminal.observedAt)) refuse();
      Object.assign(result, { terminal: JSON.parse(canonicalJson(terminal)) });
    } else if (value.state === "finalized-success" || value.state === "finalized-reverted") refuse();
    this.guard(); return freeze(result);
  }
  async inspectNamespace(sender: string): Promise<Readonly<FundingNamespaceSnapshot>> {
    if (typeof sender !== "string" || !ADDRESS.test(sender)) refuse();
    const value = record(await this.rpc("inspect_namespace", { p_sender: sender }));
    if (value.sender !== sender || typeof value.backendBindingDigest !== "string") refuse();
    // Inspection displays the immutable installed binding; it does not adopt it
    // as runtime authority. Every mutating SQL entry point recomputes native IDs.
    return validateFundingNamespace(value, this.getStorageIdentity(), value.backendBindingDigest);
  }
  async inspectOperation(operationId: string) { uuid(operationId); const value = await this.rpc("inspect_operation", { p_operation_id: operationId }); return value === null ? null : this.operation(value, operationId); }
  async admitOperation(operationId: string) { uuid(operationId); return this.operation(await this.rpc("admit", { p_operation_id: operationId }), operationId); }
  async reserveStep(operationId: string, selectedStep: GatewayFundingStep, originalNonce: string) {
    uuid(operationId); step(selectedStep); uint(originalNonce);
    const operation = await this.inspectOperation(operationId); if (!operation) refuse();
    const transaction = prepareGatewayFundingTransaction(operation, selectedStep, originalNonce);
    const result = await this.snapshot(await this.rpc("reserve", { p_operation_id: operationId, p_step: selectedStep, p_terms: transaction }), operationId, selectedStep);
    if (gatewayFundingOperationDigest(result.operation) !== gatewayFundingOperationDigest(operation) || result.transaction.nonce !== originalNonce) refuse();
    return result;
  }
  async inspectReservation(operationId: string, selectedStep: GatewayFundingStep) {
    uuid(operationId); step(selectedStep); const value = await this.rpc("inspect_reservation", { p_operation_id: operationId, p_step: selectedStep });
    return value === null ? null : this.snapshot(value, operationId, selectedStep);
  }
  private async claim(kind: "crypto" | "broadcast", operationId: string, selectedStep: GatewayFundingStep, claimId: string): Promise<Readonly<FundingClaimResult>> {
    uuid(operationId); step(selectedStep); uuid(claimId);
    const value = record(await this.rpc(`claim_${kind}`, { p_operation_id: operationId, p_step: selectedStep, p_claim_id: claimId }));
    fundingRecord(value, ["fresh", "claimId", "reservation"]);
    if (typeof value.fresh !== "boolean" || value.claimId !== claimId) refuse();
    const reservation = await this.snapshot(value.reservation, operationId, selectedStep);
    if ((kind === "crypto" ? reservation.cryptoClaimId : reservation.broadcastClaimId) !== claimId) refuse();
    return freeze({ fresh: value.fresh, claimId, reservation });
  }
  claimCrypto(operationId: string, selectedStep: GatewayFundingStep, claimId: string) { return this.claim("crypto", operationId, selectedStep, claimId); }
  claimBroadcast(operationId: string, selectedStep: GatewayFundingStep, claimId: string) { return this.claim("broadcast", operationId, selectedStep, claimId); }
  async savePrepared(operationId: string, selectedStep: GatewayFundingStep, cryptoClaimId: string, value: Readonly<{ rawTransaction: string; transactionHash: string }>) {
    uuid(operationId); step(selectedStep); uuid(cryptoClaimId);
    const reservation = await this.inspectReservation(operationId, selectedStep);
    if (!reservation || reservation.cryptoClaimId !== cryptoClaimId) refuse();
    const signed = await validateSignedGatewayFundingTransaction(reservation.operation, selectedStep, reservation.transaction.nonce, value, this.guard);
    this.guard();
    const result = await this.snapshot(await this.rpc("save_prepared", { p_operation_id: operationId, p_step: selectedStep, p_crypto_claim_id: cryptoClaimId,
      p_raw_transaction: signed.rawTransaction, p_transaction_hash: signed.transactionHash }), operationId, selectedStep);
    if (result.cryptoClaimId !== cryptoClaimId || result.prepared?.rawTransaction !== signed.rawTransaction || result.prepared.transactionHash !== signed.transactionHash) refuse();
    return result;
  }
  async appendCandidateObservation(input: FundingCandidateObservation): Promise<Readonly<FundingCandidateObservation>> {
    const value = record(input); uuid(input.observationId); uuid(input.operationId); step(input.step);
    if (Object.keys(value).sort().join(",") !== ["format", "observationId", "operationId", "step", "transactionHash", "status", "observedAt", "evidenceDigest"].sort().join(",")
      || input.format !== "gateway-funding-candidate-observation-v1" || !["unknown", "seen"].includes(input.status)
      || !/^0x[0-9a-f]{64}$/.test(input.transactionHash) || !/^[0-9a-f]{64}$/.test(input.evidenceDigest)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.observedAt)) refuse();
    const copied = JSON.parse(JSON.stringify(input)) as FundingCandidateObservation;
    const result = await this.rpc("append_observation", { p_observation: copied });
    if (JSON.stringify(result) !== JSON.stringify(copied)) {
      const observed = record(result); if (Object.keys(copied).some(key => observed[key] !== value[key])) refuse();
    }
    return freeze(copied);
  }
}

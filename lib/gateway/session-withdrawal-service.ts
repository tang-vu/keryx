import { createPublicClient, encodeFunctionData, serializeTransaction, type Hex } from "viem";
import { z } from "zod";
import { config } from "../config";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import type { KeryxDB } from "../db/keryx-db";
import { canonicalJson } from "../canonical-json";
import { mainnetGrantPolicy } from "../payments/mainnet-session-grants";
import { readRetainedMainnetSessionAuthority } from "../payments/retained-session-authority";
import { getGatewayAvailableAtomic } from "./gateway-balance";
import { sessionWithdrawalPrepareInput, verifySessionWithdrawalPreparation } from "./session-withdrawal-protocol";
import { prepareWithdrawIntentForProfile } from "./withdraw-intent-core";
import { validateWithdrawIntent, withdrawPolicySchema } from "./withdraw-protocol";
import { withdrawalHeightWindowForRpc } from "./withdrawal-height-window";
import { estimateWithdrawalIntent } from "./withdrawal-estimate";
import { createWithdrawalRequest } from "./withdrawal-request";
import { requestCircleWithdrawalTransfer, submitWithdrawalTransfer, withdrawalTransferProgress } from "./withdrawal-transfer-service";
import { withdrawalMintObserverForRpc, WITHDRAWAL_MINTER_ABI } from "./withdrawal-mint-observation";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";
import { withdrawalReceiptObserverForRpc } from "./withdrawal-receipt-observation";
import { verifySessionWithdrawalCompletion } from "./session-withdrawal-completion";
import { withdrawalMintTermsSchema } from "./withdrawal-mint-transaction";
import { configuredSessionCashoutMaxAheadBlocks } from "../session/browser-session-cashout-policy";
import { sessionWithdrawalCancellationSchema } from "./session-withdrawal-protocol";

const integer = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
/** Operator-owned fee/height limits, independent of browser input and treasury
 * custody. No relay, funding executor or private key is initialized here. */
function preparationPolicy() {
  mainnetGrantPolicy();
  return { maxFeeMicros: integer.parse(process.env.KERYX_WITHDRAWAL_MAX_FEE_MICROS),
    heightLimits: { maxAheadBlocks: configuredSessionCashoutMaxAheadBlocks(),
      maxProcessingLagBlocks: integer.parse(process.env.KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS) } };
}
export async function prepareSessionWithdrawal(db: KeryxDB, owner: string, input: unknown, signal: AbortSignal) {
  const body = sessionWithdrawalPrepareInput.parse(input);
  const proof = await readRetainedMainnetSessionAuthority(db, owner, body.grantEpoch, body.sessAddr);
  const existing = await db.pendingSessionWithdrawal(owner, body.sessAddr);
  if (existing) return existing; // Lost response recovers the original salt/fees, never a new request.
  const selected = preparationPolicy(), before = await db.sessionWithdrawalAccounting(body.sessAddr);
  const available = await getGatewayAvailableAtomic(body.sessAddr, ARC_MAINNET_PROFILE);
  if (available === null || available > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Withdrawal balance unavailable");
  const policy = withdrawPolicySchema.parse({ owner: body.sessAddr, recipient: owner,
    domain: ARC_MAINNET_PROFILE.cctpDomain, gatewayWallet: ARC_MAINNET_PROFILE.gatewayWallet,
    gatewayMinter: ARC_MAINNET_PROFILE.gatewayMinter, asset: ARC_MAINNET_PROFILE.usdcAddress,
    maxValueMicros: body.amountMicros, maxFeeMicros: selected.maxFeeMicros });
  const height = await withdrawalHeightWindowForRpc(config.rpcUrl, policy, selected.heightLimits, signal, ARC_MAINNET_PROFILE);
  const unsigned = prepareWithdrawIntentForProfile(ARC_MAINNET_PROFILE, body.sessAddr, body.amountMicros, owner, selected.maxFeeMicros);
  const burnIntent = await estimateWithdrawalIntent(unsigned, policy, { minimumBlockHeight: height.minimumBlockHeight,
    maximumBlockHeight: height.maximumBlockHeight }, signal, ARC_MAINNET_PROFILE);
  signal.throwIfAborted();
  const accounting = await db.sessionWithdrawalAccounting(body.sessAddr);
  if (canonicalJson(accounting) !== canonicalJson(before)) throw new Error("Withdrawal accounting changed");
  const exactPolicy = { ...policy, maxFeeMicros: burnIntent.maxFee };
  const packet = await verifySessionWithdrawalPreparation({ format: "keryx-session-withdrawal-preparation-v1",
    network: ARC_MAINNET_PROFILE.networkId, requestId: validateWithdrawIntent(burnIntent, exactPolicy).id,
    ownerAddr: owner, sessAddr: body.sessAddr, grantEpoch: body.grantEpoch, authorization: proof, burnIntent,
    policy: exactPolicy, balance: { availableMicroUsdc: String(available), heldPaymentMicroUsdc: accounting.heldPaymentMicroUsdc,
      heldWithdrawalMicroUsdc: accounting.heldWithdrawalMicroUsdc, confirmedSpentMicroUsdc: accounting.confirmedSpentMicroUsdc,
      maxFeeMicroUsdc: burnIntent.maxFee }, height });
  return db.reserveSessionWithdrawal(packet);
}
export async function sessionWithdrawalStatus(db: KeryxDB, owner: string, requestId: string, signal: AbortSignal) {
  mainnetGrantPolicy();
  const preparation = await db.getSessionWithdrawal(requestId, owner);
  if (!preparation) return null;
  await readRetainedMainnetSessionAuthority(db, owner, preparation.grantEpoch, preparation.sessAddr);
  const progress = await withdrawalTransferProgress(db, requestId, preparation.sessAddr);
  const attestation = await db.getCreatorWithdrawalAttestation(requestId, preparation.sessAddr);
  const completion = await db.getSessionWithdrawalCompletion(requestId, owner);
  const signingPhase = await db.getSessionWithdrawalSigningPhase(requestId, owner);
  if (!signingPhase) throw new Error("Original withdrawal phase unavailable");
  const cancellation = signingPhase === "cancelled_unexposed" ? sessionWithdrawalCancellationSchema.parse({
    format: "keryx-session-withdrawal-cancellation-v1", network: preparation.network,
    requestId, ownerAddr: owner, sessAddr: preparation.sessAddr, reason: "cancelled-unexposed" }) : null;
  let mint = null;
  if (attestation && !completion && !cancellation) {
    const record = await db.getCreatorWithdrawal(requestId, preparation.sessAddr);
    if (!record || canonicalJson(record.request.burnIntent) !== canonicalJson(preparation.burnIntent)) throw new Error("Original withdrawal conflict");
    const observation = await withdrawalMintObserverForRpc(config.rpcUrl)(record, attestation, owner, signal);
    if (observation) mint = { to: preparation.policy.gatewayMinter, data: encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI,
      functionName: "gatewayMint", args: [attestation.attestation, attestation.signature] }), value: "0", network: ARC_MAINNET_PROFILE.networkId, observation };
  }
  return { preparation, signingPhase, cancellation,
    progress: { status: cancellation ? "cancelled-unexposed" : completion ? "mint-finalized-observed" : progress?.status ?? "prepared", retryAuthorized: false,
    chainFinalityVerified: !!completion }, attestation, mint, completion };
}
export async function submitSessionWithdrawal(db: KeryxDB, owner: string, id: string, signature: Hex, signal: AbortSignal) {
  const preparation = await db.getSessionWithdrawal(id, owner);
  if (!preparation) return null;
  if (await db.getSessionWithdrawalSigningPhase(id, owner) !== "exposed") throw new Error("Original withdrawal signing not authorized");
  await readRetainedMainnetSessionAuthority(db, owner, preparation.grantEpoch, preparation.sessAddr);
  const original = await createWithdrawalRequest({ burnIntent: preparation.burnIntent, signature }, preparation.policy, ARC_MAINNET_PROFILE);
  if (original.id !== id) throw new Error("Original withdrawal conflict");
  await submitWithdrawalTransfer(db, original, preparation.sessAddr, async (record, currentSignal) => {
    // Capacity was reserved durably before exposing the unsigned original. Recheck
    // that original and fresh finite height before acquiring the one transfer claim.
    const retained = await db.getSessionWithdrawal(id, owner);
    if (!retained || canonicalJson(retained) !== canonicalJson(preparation)) throw new Error("Original withdrawal conflict");
    const selected = preparationPolicy();
    if (BigInt(record.request.burnIntent.maxFee) > BigInt(selected.maxFeeMicros)) throw new Error("Withdrawal fee refused");
    const window = await withdrawalHeightWindowForRpc(config.rpcUrl, record.policy, selected.heightLimits, currentSignal, ARC_MAINNET_PROFILE);
    const height = BigInt(record.request.burnIntent.maxBlockHeight);
    if (height < BigInt(window.minimumBlockHeight) || height > BigInt(window.maximumBlockHeight)) throw new Error("Withdrawal height refused");
  }, requestCircleWithdrawalTransfer, signal);
  return sessionWithdrawalStatus(db, owner, id, signal);
}

export async function transitionSessionWithdrawal(db: KeryxDB, owner: string, id: string, action: "authorize" | "cancel", signal: AbortSignal) {
  mainnetGrantPolicy();
  const p = await db.getSessionWithdrawal(id, owner); if (!p) return null;
  await readRetainedMainnetSessionAuthority(db, owner, p.grantEpoch, p.sessAddr);
  if (action === "authorize") await db.authorizeSessionWithdrawal(id, owner);
  else await db.cancelSessionWithdrawal(id, owner);
  return sessionWithdrawalStatus(db, owner, id, signal);
}

/** The client supplies only the original ID and public transaction hash. All mint
 * bytes, logs and canonical finality come from the selected server-owned RPC.
 * This path never signs, broadcasts, retries a burn or loads treasury authority. */
export async function completeSessionWithdrawal(db: KeryxDB, owner: string, id: string, transactionHash: Hex, signal: AbortSignal) {
  mainnetGrantPolicy();
  const p = await db.getSessionWithdrawal(id, owner);
  if (!p) return null;
  const prior = await db.getSessionWithdrawalCompletion(id, owner);
  if (prior) {
    if (prior.observation.transactionHash !== transactionHash) throw new Error("Original mint conflict");
    return sessionWithdrawalStatus(db, owner, id, signal);
  }
  await readRetainedMainnetSessionAuthority(db, owner, p.grantEpoch, p.sessAddr);
  const record = await db.getCreatorWithdrawal(id, p.sessAddr), attestation = await db.getCreatorWithdrawalAttestation(id, p.sessAddr);
  if (!record || !attestation) throw new Error("Original mint authority unavailable");
  const client = createPublicClient({ transport: withdrawalRpcTransport(config.rpcUrl, signal) });
  if (await client.getChainId() !== ARC_MAINNET_PROFILE.chainId) throw new Error("Mint network refused");
  const t = await client.getTransaction({ hash: transactionHash }); signal.throwIfAborted();
  if (t.type !== "eip1559" || t.hash !== transactionHash || t.chainId !== ARC_MAINNET_PROFILE.chainId ||
    t.from.toLowerCase() !== owner || !t.r || !t.s || t.yParity === undefined) throw new Error("Owner mint transaction refused");
  const raw = serializeTransaction({ type: "eip1559", chainId: t.chainId, nonce: t.nonce, gas: t.gas,
    maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas, to: t.to, data: t.input,
    value: t.value, accessList: t.accessList, r: t.r, s: t.s, yParity: t.yParity });
  const terms = withdrawalMintTermsSchema.parse({ relayer: owner, nonce: t.nonce, gas: String(t.gas), maxFeePerGas: String(t.maxFeePerGas),
    maxPriorityFeePerGas: String(t.maxPriorityFeePerGas), gasBudgetWei: String(t.gas * t.maxFeePerGas) });
  const observation = await withdrawalReceiptObserverForRpc(config.rpcUrl)(record, attestation, raw, terms, signal);
  signal.throwIfAborted(); if (!observation || observation.transactionHash !== transactionHash) throw new Error("Original finalized mint evidence unavailable");
  const outcome = await verifySessionWithdrawalCompletion({ format: "keryx-session-withdrawal-completion-v1", network: p.network,
    requestId: p.requestId, ownerAddr: owner, sessAddr: p.sessAddr, record, attestation,
    serializedTransaction: raw, terms, observation }, p);
  await db.recordWithdrawal({ txHash: transactionHash, createdAt: observation.observedAt, label: "session",
    wallet: p.sessAddr, recipient: owner, amountUsdc: Number(p.burnIntent.spec.value) / 1e6, network: p.network });
  await db.completeSessionWithdrawal(id, owner, outcome);
  return sessionWithdrawalStatus(db, owner, id, signal);
}

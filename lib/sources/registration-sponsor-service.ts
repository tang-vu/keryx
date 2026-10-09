import { encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, type Hex, type TransactionReceipt, type TransactionSerializableEIP1559 } from "viem";
import type { KeryxDB } from "../db/keryx-db";
import { RegistrationSponsorError } from "../db/registration-sponsor";
import { confirmsRegistration, registrationId } from "./registration-status";
import { canonicalSourceUrl, claimControlIsFresh } from "./public-source-claim";
import { prepareSourceRegistration } from "./prepare-registration";
import { REGISTRATION_SPONSOR_ABI, registrationContractRequest, registrationIntentDigest, registrationParamsSchema,
  registrationPolicyDigest, registrationTypedData, type RegistrationSponsorPolicy, type SponsoredRegistration } from "./registration-sponsor-protocol";

export interface RegistrationSponsorChain {
  assertRegistry(): Promise<void>;
  registrationNonce(creator: Hex): Promise<bigint>;
  transactionNonce(): Promise<number>;
  estimateGas(data: Hex): Promise<bigint>;
  sign(transaction: TransactionSerializableEIP1559): Promise<Hex>;
  broadcast(raw: Hex): Promise<Hex>;
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
}
export interface RegistrationSponsorContext {
  db: KeryxDB; policy: RegistrationSponsorPolicy; chain: RegistrationSponsorChain;
  assertPolicy(): void; now?(): number;
}
function refused(message: string, code = "sponsorship_unavailable", status = 503): never { throw new RegistrationSponsorError(message, status, code); }
function store(db: KeryxDB) {
  if (!db.admitRegistrationSponsor || !db.getRegistrationSponsor || !db.transitionRegistrationSponsor)
    return refused("Atomic gas sponsorship is unavailable on this storage backend");
  return { admit: db.admitRegistrationSponsor.bind(db), get: db.getRegistrationSponsor.bind(db), transition: db.transitionRegistrationSponsor.bind(db) };
}
function active(ctx: RegistrationSponsorContext, wallet: string) {
  ctx.assertPolicy();
  const now = ctx.now?.() ?? Date.now();
  if (now >= ctx.policy.expiresAt || !ctx.policy.allowlistedCreators.includes(wallet.toLowerCase() as Hex))
    refused("This wallet has no active registration gas sponsorship", "sponsor_ineligible", 403);
  return now;
}
async function claimFor(ctx: RegistrationSponsorContext, wallet: string, claimId: string) {
  const claim = await ctx.db.getSourceClaim?.(claimId);
  if (!claim || claim.ownerWallet !== wallet.toLowerCase()) refused("Verify publishing control with this wallet first", "proof_required", 403);
  if (claim.network !== ctx.policy.network || claim.deploymentOrigin !== ctx.policy.deploymentOrigin ||
    claim.registryAddress && claim.registryAddress !== ctx.policy.registryAddress ||
    !claimControlIsFresh(claim, ctx.now?.() ?? Date.now()))
    refused("Refresh this source's publishing-control proof", "proof_stale", 409);
  if (!claim.rssUrl) refused("Sponsored feed registration requires a verified exact RSS feed", "feed_proof_required", 409);
  if (new URL(claim.rssUrl).origin !== new URL(claim.canonicalUrl).origin) refused("The verified feed must belong to this publisher's origin", "feed_proof_required", 409);
  return claim;
}
export async function prepareSponsoredRegistration(ctx: RegistrationSponsorContext, wallet: string, input: { claimId: string; fetchPrice: number; replacesRequestId?: Hex }) {
  const now = active(ctx, wallet), journal = store(ctx.db);
  const claim = await claimFor(ctx, wallet, input.claimId);
  const prior = await journal.get({ wallet, canonicalUrl: claim.canonicalUrl });
  if (prior && !input.replacesRequestId) return prior; // Reload never creates a new original or refreshes its signature.
  if (input.replacesRequestId && (!prior || prior.id !== input.replacesRequestId || prior.state !== "expired" ||
    now < (prior.deadline + 1) * 1000)) refused("Only a conclusively expired unsigned original may be renewed", "renewal_refused", 409);
  await ctx.chain.assertRegistry();
  const result = await prepareSourceRegistration(ctx.db, wallet, { sourceClaimId: claim.id,
    url: claim.canonicalUrl, rssUrl: claim.rssUrl, fetchPrice: input.fetchPrice });
  if (result.status !== 200 || result.payload.mode !== "onchain") refused("Source preparation failed; no sponsored transaction was signed", "preparation_failed", 409);
  const refreshed = await claimFor(ctx, wallet, claim.id);
  const params = registrationParamsSchema.parse(result.payload.registerParams);
  const nonce = await ctx.chain.registrationNonce(wallet as Hex);
  active(ctx, wallet);
  const row: SponsoredRegistration = { id: `0x${"00".repeat(32)}`, policyDigest: registrationPolicyDigest(ctx.policy),
    creator: wallet.toLowerCase() as Hex, canonicalUrl: canonicalSourceUrl(claim.canonicalUrl), rssUrl: refreshed.rssUrl!, claimId: claim.id,
    ...(input.replacesRequestId ? { replacesRequestId: input.replacesRequestId } : {}),
    claimRevision: refreshed.revision, sourceId: String(result.payload.sourceId), onchainId: registrationId(wallet as Hex, params.urlHash),
    registryAddress: ctx.policy.registryAddress, registryCodeHash: ctx.policy.registryCodeHash, relayer: ctx.policy.sponsorAddress,
    chainId: ctx.policy.network === "eip155:5042" ? 5042 : 5042002, params, nonce: nonce.toString(),
    deadline: Math.floor(Math.min(now + 10 * 60_000, ctx.policy.expiresAt) / 1000), createdAt: now, updatedAt: now,
    reservedWei: ctx.policy.maxTransactionWei, state: "prepared" };
  row.id = registrationIntentDigest(row);
  return journal.admit(ctx.policy, row, ctx.now?.() ?? Date.now());
}
export async function submitSponsoredRegistration(ctx: RegistrationSponsorContext, wallet: string, id: Hex, signature: Hex) {
  const journal = store(ctx.db), row = await journal.get({ wallet, id });
  if (!row) refused("Original sponsored registration not found", "original_not_found", 404);
  if (row.state !== "prepared") return row; // Every further call is inspection only.
  const now = active(ctx, wallet);
  if (now > row.deadline * 1000) return journal.transition({ wallet, id, expectedState: "prepared", nextState: "expired", now });
  if (row.policyDigest !== registrationPolicyDigest(ctx.policy)) refused("Retain the original policy; registration was not submitted", "policy_changed", 409);
  let recovered;
  try { recovered = await recoverTypedDataAddress({ ...registrationTypedData(row), signature }); }
  catch { return refused("Creator registration signature is invalid", "signature_invalid", 403); }
  if (recovered.toLowerCase() !== row.creator) refused("Only the prepared creator may sign this registration", "signature_invalid", 403);
  const claim = await claimFor(ctx, wallet, row.claimId);
  if (claim.revision !== row.claimRevision || claim.canonicalUrl !== row.canonicalUrl || claim.rssUrl !== row.rssUrl || claim.linkedSourceId !== row.sourceId ||
    claim.onchainId?.toLowerCase() !== row.onchainId) refused("Source proof changed; retain this original", "proof_changed", 409);
  await ctx.chain.assertRegistry();
  if (await ctx.chain.registrationNonce(row.creator) !== BigInt(row.nonce)) refused("Creator registration nonce changed; retain this original", "nonce_changed", 409);
  const data = encodeFunctionData({ abi: REGISTRATION_SPONSOR_ABI, functionName: "registerWithSignature", args: [registrationContractRequest(row), signature] });
  if (await ctx.chain.estimateGas(data) > BigInt(ctx.policy.maxGas)) refused("Registration exceeds its sponsor gas limit", "gas_limit", 409);
  const transactionNonce = await ctx.chain.transactionNonce();
  active(ctx, wallet);
  await journal.transition({ wallet, id, expectedState: "prepared", nextState: "signing", transactionNonce, now: ctx.now?.() ?? Date.now() });
  // Any exception after this durable boundary retains the complete maximum hold.
  // It never grants another transaction nonce, signature or automatic broadcast.
  try {
    const transaction: TransactionSerializableEIP1559 = { type: "eip1559", chainId: row.chainId, nonce: transactionNonce,
      to: row.registryAddress, data, value: BigInt(0), gas: BigInt(ctx.policy.maxGas),
      maxFeePerGas: BigInt(ctx.policy.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(1) };
    await ctx.chain.assertRegistry(); active(ctx, wallet);
    const raw = await ctx.chain.sign(transaction), parsed = parseTransaction(raw);
    if ((await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] })).toLowerCase() !== row.relayer ||
      parsed.type !== "eip1559" || parsed.chainId !== row.chainId || parsed.nonce !== transactionNonce ||
      parsed.to?.toLowerCase() !== row.registryAddress || parsed.data?.toLowerCase() !== data.toLowerCase() ||
      (parsed.value ?? BigInt(0)) !== BigInt(0) || parsed.gas !== transaction.gas || parsed.maxFeePerGas !== transaction.maxFeePerGas ||
      parsed.maxPriorityFeePerGas !== transaction.maxPriorityFeePerGas || parsed.accessList?.length) throw new Error();
    const transactionHash = keccak256(raw);
    await journal.transition({ wallet, id, expectedState: "signing", nextState: "submitted", transactionHash, now: ctx.now?.() ?? Date.now() });
    await ctx.chain.assertRegistry(); active(ctx, wallet);
    const returned = await ctx.chain.broadcast(raw);
    if (returned.toLowerCase() !== transactionHash) throw new Error();
  } catch { /* Unknown signing/submission retains the original. Never expose SDK/key diagnostics. */ }
  return (await journal.get({ wallet, id }))!;
}
export async function recoverSponsoredRegistration(db: KeryxDB, wallet: string, id: Hex,
  chain: Pick<RegistrationSponsorChain, "assertRegistry" | "receipt">, now = Date.now()) {
  const journal = store(db), row = await journal.get({ wallet, id });
  if (!row) return null;
  if (row.state === "prepared" && now > row.deadline * 1000)
    return journal.transition({ wallet, id, expectedState: "prepared", nextState: "expired", now });
  if (row.state !== "submitted" || !row.transactionHash) return row;
  await chain.assertRegistry();
  const receipt = await chain.receipt(row.transactionHash);
  if (!receipt) return row;
  if (receipt.transactionHash.toLowerCase() !== row.transactionHash || receipt.from.toLowerCase() !== row.relayer ||
    receipt.to?.toLowerCase() !== row.registryAddress || receipt.gasUsed < BigInt(0) || receipt.effectiveGasPrice < BigInt(0))
    return refused("Original receipt identity differs; retain the full sponsor reservation", "receipt_mismatch", 409);
  const actualGasWei = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
  if (receipt.status === "success" && !confirmsRegistration(receipt, { registry: row.registryAddress, creator: row.creator, onchainId: row.onchainId }))
    return refused("The original receipt does not confirm this creator's registration", "receipt_mismatch", 409);
  return journal.transition({ wallet, id, expectedState: "submitted", nextState: receipt.status === "success" ? "confirmed" : "reverted", actualGasWei, now });
}

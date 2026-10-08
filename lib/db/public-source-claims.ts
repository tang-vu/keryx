import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { canonicalSourceUrl, sourceClaimSchema, sourceClaimChallengeSchema,
  SOURCE_CLAIM_CHALLENGE_TTL_MS, SOURCE_CLAIM_PROOF_MAX_AGE_MS,
  type SourceClaim, type SourceClaimChallenge, type IssueSourceClaimChallenge,
  type VerifySourceClaim, type BindSourceClaim, type UpdateSourceClaimPolicy } from "../sources/public-source-claim";
import { claimControlIsFresh, sourceClaimReceiptSchema } from "../sources/public-source-claim";
import type { SourceClaimReceipt } from "../types";
import { config } from "../config";
import { operatingFeeContextSchema, operatingFeeMaxMicroUsdc, operatingFeePolicySchema, operatingFeePolicyDigest, operatingFeeRequestHash,
  OPERATING_FEE_SOURCE_ID, OPERATING_FEE_POLICY_KEY_PREFIX } from "../payments/operating-fee-policy";
import { hostedTreasuryPolicySchema } from "../payments/hosted-treasury-policy";

const PREFIX = "keryx:source-claims:v1:";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const rateSchema = z.object({ hour: z.number().int().nonnegative(), count: z.number().int().nonnegative().max(10) }).strict();
const bindingSchema = z.object({ sourceId: z.string().min(1).max(256), claimId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const historySchema = z.object({ claim: sourceClaimSchema, action: z.enum(["verified", "linked-free", "policy"]),
  at: z.string().datetime(), evidence: z.unknown() }).strict();
export class SourceClaimError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "claim_conflict") { super(message); this.name = "SourceClaimError"; }
}
export function publicSourceClaimId(canonicalUrl: string, deploymentOrigin: string, network: string): string {
  return digest(canonicalJson({ canonicalUrl: canonicalSourceUrl(canonicalUrl), deploymentOrigin, network }));
}
function read(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value FROM sync_state WHERE key=?").get(PREFIX + key);
  return row ? JSON.parse(String(row.value)) : null;
}
function put(db: DatabaseSync, key: string, value: unknown, now: number): void {
  db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(PREFIX + key, canonicalJson(value), new Date(now).toISOString());
}
function atomic<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = operation(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function getSqliteSourceClaim(db: DatabaseSync, id: string): SourceClaim | null {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const value = read(db, `claim:${id}`);
  if (!value) return null;
  const claim = sourceClaimSchema.parse(value);
  const original = historySchema.parse(read(db, `history:${id}:${String(1).padStart(16, "0")}`));
  const latest = historySchema.parse(read(db, `history:${id}:${String(claim.revision).padStart(16, "0")}`));
  if (original.action !== "verified" || original.claim.revision !== 1 || original.claim.mode !== "free" ||
    original.claim.ownerWallet !== claim.ownerWallet || original.claim.canonicalUrl !== claim.canonicalUrl ||
    original.claim.network !== claim.network || original.claim.deploymentOrigin !== claim.deploymentOrigin ||
    canonicalJson(latest.claim) !== canonicalJson(claim)) throw new Error("Source claim history is missing or inconsistent");
  const proof = z.object({ challengeId: z.string().regex(/^[a-f0-9]{64}$/), proofDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(original.evidence);
  const challenge = getSqliteSourceClaimChallenge(db, proof.challengeId);
  if (!challenge?.consumedAt || challenge.claimId !== claim.id || challenge.wallet !== claim.ownerWallet)
    throw new Error("Original source-control proof history is unavailable");
  return claim;
}
export function getSqliteSourceClaimChallenge(db: DatabaseSync, id: string): SourceClaimChallenge | null {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const value = read(db, `challenge:${id}`); return value ? sourceClaimChallengeSchema.parse(value) : null;
}
/** Catalog projection only: retained presence must survive an unreadable policy/history. */
export function getRetainedSourceClaimMarker(db: DatabaseSync, sourceId: string): string | null {
  const sourceDigest = digest(sourceId);
  const row = db.prepare("SELECT value FROM sync_state WHERE key=?").get(PREFIX + `marker:${sourceDigest}`)
    ?? db.prepare("SELECT value FROM sync_state WHERE key=?").get(PREFIX + `source:${sourceDigest}`);
  if (row) {
    try {
      const binding = bindingSchema.safeParse(JSON.parse(String(row.value)));
      if (binding.success && binding.data.sourceId === sourceId) return binding.data.claimId;
    } catch { /* Corrupt retained state is managed, never a legacy earning fallback. */ }
    return digest(`unavailable-source-claim:${sourceId}`);
  }
  // Pre-marker records and deletion-only corruption still retain their linked identity.
  // json_valid guards unrelated damaged records; this lookup grants no policy authority.
  const retained = db.prepare(`SELECT key,value FROM sync_state WHERE (key LIKE ? OR key LIKE ?)
    AND CASE WHEN json_valid(value) THEN COALESCE(json_extract(value,'$.linkedSourceId'),json_extract(value,'$.claim.linkedSourceId')) END=? LIMIT 1`)
    .get(PREFIX + "claim:%", PREFIX + "history:%", sourceId);
  if (!retained) return null;
  try {
    const value = JSON.parse(String(retained.value));
    const claim = sourceClaimSchema.safeParse(String(retained.key).startsWith(PREFIX + "history:") ? value.claim : value);
    if (claim.success && claim.data.linkedSourceId === sourceId) return claim.data.id;
  } catch { /* Corrupt retained state is managed, never a legacy earning fallback. */ }
  return digest(`unavailable-source-claim:${sourceId}`);
}
export function getSqliteSourceClaimForSource(db: DatabaseSync, sourceId: string): SourceClaim | null {
  const row = db.prepare("SELECT value FROM sync_state WHERE key=?").get(PREFIX + `source:${digest(sourceId)}`);
  if (!row) {
    if (getRetainedSourceClaimMarker(db, sourceId)) throw new Error("Retained managed source binding is unavailable");
    return null;
  }
  const parsed = bindingSchema.parse(JSON.parse(String(row.value)));
  if (parsed.sourceId !== sourceId) throw new Error("Invalid retained source claim binding");
  if (getRetainedSourceClaimMarker(db, sourceId) !== parsed.claimId) throw new Error("Retained managed source marker differs from its binding");
  const claim = getSqliteSourceClaim(db, parsed.claimId);
  if (!claim || claim.linkedSourceId !== sourceId) throw new Error("Orphaned source claim binding");
  return claim;
}
export function listSqliteSourceClaims(db: DatabaseSync, wallet?: string): SourceClaim[] {
  const rows = db.prepare("SELECT value FROM sync_state WHERE key LIKE ? ORDER BY key LIMIT 1001").all(PREFIX + "claim:%");
  if (rows.length > 1000) throw new Error("Source claim listing limit exceeded");
  return rows.map(row => getSqliteSourceClaim(db, sourceClaimSchema.parse(JSON.parse(String(row.value))).id)!)
    .filter(claim => !wallet || claim.ownerWallet === wallet.toLowerCase());
}
function owned(db: DatabaseSync, id: string, wallet: string, revision?: number): SourceClaim {
  const claim = getSqliteSourceClaim(db, id);
  if (!claim) throw new SourceClaimError("Source claim not found", 404, "claim_not_found");
  if (claim.ownerWallet !== wallet.toLowerCase()) throw new SourceClaimError("Only the verified source owner may change this claim", 403, "wrong_owner");
  if (revision !== undefined && claim.revision !== revision) throw new SourceClaimError("Source claim changed; refresh before continuing");
  return claim;
}
function saveRevision(db: DatabaseSync, claim: SourceClaim, action: string, now: number, extra: unknown = {}): SourceClaim {
  const checked = sourceClaimSchema.parse(claim);
  const key = `history:${claim.id}:${String(claim.revision).padStart(16, "0")}`;
  if (read(db, key)) throw new SourceClaimError("Source claim revision already exists");
  put(db, key, { claim: checked, action, at: new Date(now).toISOString(), evidence: extra }, now);
  put(db, `claim:${claim.id}`, checked, now);
  return checked;
}
export function issueSqliteSourceClaimChallenge(db: DatabaseSync, input: IssueSourceClaimChallenge): SourceClaimChallenge {
  const now = input.now ?? Date.now();
  const canonicalUrl = canonicalSourceUrl(input.canonicalUrl), rssUrl = input.rssUrl ? canonicalSourceUrl(input.rssUrl) : undefined;
  // Feed ownership is never delegated to a different origin by a caller-selected URL.
  if (rssUrl && new URL(rssUrl).origin !== new URL(canonicalUrl).origin) throw new SourceClaimError("Feed and source must share an HTTPS origin", 400, "feed_origin_mismatch");
  if (input.proofMethod === "rss-channel" && (!rssUrl || !input.publicReferenceId && canonicalUrl !== rssUrl))
    throw new SourceClaimError("General RSS claims verify the exact feed URL; an approved catalog reference is required to bind a different homepage", 400, "feed_scope_mismatch");
  const claimId = publicSourceClaimId(canonicalUrl, input.deploymentOrigin, input.network);
  const challenge = sourceClaimChallengeSchema.parse({ id: randomBytes(32).toString("hex"), claimId,
    wallet: input.wallet, canonicalUrl, ...(rssUrl ? { rssUrl } : {}),
    ...(input.publicReferenceId ? { publicReferenceId: input.publicReferenceId } : {}),
    deploymentOrigin: input.deploymentOrigin, network: input.network, nonce: randomBytes(32).toString("hex"),
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SOURCE_CLAIM_CHALLENGE_TTL_MS).toISOString(),
    proofMethod: input.proofMethod ?? "website-file" });
  return atomic(db, () => {
    const current = getSqliteSourceClaim(db, claimId);
    if (current && current.ownerWallet !== challenge.wallet) throw new SourceClaimError("This source already has a verified owner");
    if (current && (current.rssUrl !== rssUrl || current.publicReferenceId !== challenge.publicReferenceId))
      throw new SourceClaimError("Retain the original feed and catalog identity when refreshing proof");
    const hour = Math.floor(now / 3600_000);
    const key = `rate:${challenge.wallet}`;
    const rawRate = read(db, key), old = rawRate ? rateSchema.parse(rawRate) : null;
    const count = old?.hour === hour ? old.count : 0;
    if (!Number.isInteger(count) || count >= 5) throw new SourceClaimError("Source claim challenge limit reached; retry next hour", 429, "claim_rate_limit");
    put(db, key, { hour, count: count + 1 }, now);
    put(db, `challenge:${challenge.id}`, challenge, now);
    return challenge;
  });
}
export function verifySqliteSourceClaim(db: DatabaseSync, input: VerifySourceClaim): SourceClaim {
  const now = input.now ?? Date.now();
  if (!/^[a-f0-9]{64}$/.test(input.proofDigest)) throw new SourceClaimError("Invalid proof evidence", 400);
  return atomic(db, () => {
    const challenge = getSqliteSourceClaimChallenge(db, input.challengeId);
    if (!challenge || challenge.wallet !== input.wallet.toLowerCase()) throw new SourceClaimError("Claim challenge unavailable for this wallet", 403);
    if (challenge.consumedAt || now < Date.parse(challenge.createdAt) || now >= Date.parse(challenge.expiresAt))
      throw new SourceClaimError("Claim challenge expired or already used", 409, "challenge_expired");
    const current = getSqliteSourceClaim(db, challenge.claimId);
    if (current && current.ownerWallet !== challenge.wallet) throw new SourceClaimError("Source ownership changed during verification");
    if (current && (current.rssUrl !== challenge.rssUrl || current.publicReferenceId !== challenge.publicReferenceId))
      throw new SourceClaimError("Source feed or catalog identity changed during verification");
    const at = new Date(now).toISOString();
    const claim = current ? { ...current, verifiedAt: at, proofMethod: challenge.proofMethod, revision: current.revision + 1 } : {
      id: challenge.claimId, canonicalUrl: challenge.canonicalUrl, rssUrl: challenge.rssUrl,
      publicReferenceId: challenge.publicReferenceId, ownerWallet: challenge.wallet,
      deploymentOrigin: challenge.deploymentOrigin, network: challenge.network,
      verifiedAt: at, revision: 1, effectiveAt: at, mode: "free" as const, distributionPermission: false, proofMethod: challenge.proofMethod,
    };
    const saved = saveRevision(db, claim, "verified", now, { challengeId: challenge.id, proofDigest: input.proofDigest });
    put(db, `challenge:${challenge.id}`, { ...challenge, consumedAt: at }, now);
    return saved;
  });
}
/** Claim a bounded verification attempt before external DNS/HTTP work; failures consume allowance. */
export function reserveSqliteSourceClaimVerification(db: DatabaseSync, challengeId: string, wallet: string, now = Date.now()): SourceClaimChallenge {
  return atomic(db, () => {
    const challenge = getSqliteSourceClaimChallenge(db, challengeId);
    if (!challenge || challenge.wallet !== wallet.toLowerCase()) throw new SourceClaimError("Claim challenge unavailable for this wallet", 403);
    if (challenge.consumedAt || now < Date.parse(challenge.createdAt) || now >= Date.parse(challenge.expiresAt))
      throw new SourceClaimError("Claim challenge expired or already used", 409, "challenge_expired");
    const key = `verify-rate:${challenge.wallet}`, hour = Math.floor(now / 3600_000);
    const rawRate = read(db, key), old = rawRate ? rateSchema.parse(rawRate) : null;
    const count = old?.hour === hour ? old.count : 0;
    if (!Number.isInteger(count) || count >= 10) throw new SourceClaimError("Source verification limit reached; retry next hour", 429, "claim_rate_limit");
    put(db, key, { hour, count: count + 1 }, now);
    return challenge;
  });
}
export function bindSqliteSourceClaim(db: DatabaseSync, input: BindSourceClaim): SourceClaim {
  const now = input.now ?? Date.now();
  return atomic(db, () => {
    const claim = owned(db, input.claimId, input.wallet, input.expectedRevision);
    if (input.sourceId.startsWith("public:")) throw new SourceClaimError("Public reference identities remain permanently free", 400);
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sources' AND type='table'").get()) {
      const source = db.prepare("SELECT * FROM sources WHERE id=?").get(input.sourceId);
      if (source && (canonicalSourceUrl(String(source.url)) !== claim.canonicalUrl ||
        String(source.onchain_id).toLowerCase() !== input.onchainId.toLowerCase() || claim.rssUrl && source.rss_url !== claim.rssUrl))
        throw new SourceClaimError("Indexed source changed before the claim could be bound");
    }
    if (claim.linkedSourceId && (claim.linkedSourceId !== input.sourceId || claim.onchainId?.toLowerCase() !== input.onchainId.toLowerCase()
      || claim.registryAddress !== input.registryAddress.toLowerCase()))
      throw new SourceClaimError("This claim is already linked to another registry source");
    const other = getSqliteSourceClaimForSource(db, input.sourceId);
    if (other && other.id !== claim.id) throw new SourceClaimError("Registry source already belongs to another claim");
    if (claim.linkedSourceId) {
      // Upgrade an existing valid binding without changing its policy or revision.
      put(db, `marker:${digest(input.sourceId)}`, { sourceId: input.sourceId, claimId: claim.id }, now);
      return claim;
    }
    const saved = saveRevision(db, { ...claim, linkedSourceId: input.sourceId, onchainId: input.onchainId, registryAddress: input.registryAddress,
      mode: "free", distributionPermission: false, effectiveAt: new Date(now).toISOString(), revision: claim.revision + 1 }, "linked-free", now);
    put(db, `source:${digest(input.sourceId)}`, { sourceId: input.sourceId, claimId: claim.id }, now);
    put(db, `marker:${digest(input.sourceId)}`, { sourceId: input.sourceId, claimId: claim.id }, now);
    return saved;
  });
}
export function updateSqliteSourceClaimPolicy(db: DatabaseSync, input: UpdateSourceClaimPolicy): SourceClaim {
  const now = input.now ?? Date.now();
  return atomic(db, () => {
    const claim = owned(db, input.claimId, input.wallet, input.expectedRevision);
    if (input.mode !== "free" && (!claim.linkedSourceId || !input.distributionPermission))
      throw new SourceClaimError("Link a registry source and explicitly confirm distribution permission before enabling earnings", 400);
    if (input.mode !== "free" && (now < Date.parse(claim.verifiedAt) || now - Date.parse(claim.verifiedAt) > SOURCE_CLAIM_PROOF_MAX_AGE_MS))
      throw new SourceClaimError("Refresh source-control proof before enabling earnings", 409, "proof_refresh_required");
    return saveRevision(db, { ...claim, mode: input.mode, distributionPermission: input.mode !== "free" && input.distributionPermission,
      effectiveAt: new Date(now).toISOString(), revision: claim.revision + 1 }, "policy", now);
  });
}
/** Called only inside the caller's financial writer transaction, before a new authorization. */
export function assertSqliteSourceClaimPaymentPolicy(db: DatabaseSync, input: {
  sourceId: string; expected?: SourceClaimReceipt | null; kind: "fetch" | "citation"; network: string; now?: number;
}): SourceClaim | null {
  if (!db.isTransaction) throw new Error("Atomic source claim payment transaction required");
  const claim = getSqliteSourceClaimForSource(db, input.sourceId);
  const source = db.prepare("SELECT * FROM sources WHERE id=?").get(input.sourceId);
  if (!claim) {
    if (input.expected || source?.source_claim_id) throw new Error("Managed source claim binding is unavailable");
    return null;
  }
  const expected = sourceClaimReceiptSchema.parse(input.expected), now = input.now ?? Date.now();
  if (claim.id !== expected.id || claim.revision !== expected.revision || claim.mode !== expected.mode ||
    claim.effectiveAt !== expected.effectiveAt || claim.verifiedAt !== expected.verifiedAt ||
    claim.network !== input.network || claim.deploymentOrigin !== new URL(config.baseUrl).origin ||
    claim.registryAddress !== config.registryReadAddress?.toLowerCase() || !claimControlIsFresh(claim, now) ||
    Date.parse(claim.effectiveAt) > now || !claim.distributionPermission || claim.mode === "free" ||
    input.kind === "fetch" && claim.mode !== "paid") throw new Error("Current source claim policy does not admit this new payment");
  if (!source || source.active === 0 || source.verified !== 1 || source.scholarly_enrolled === 1 ||
    source.evidence_provenance === "synthetic-demo" || canonicalSourceUrl(String(source.url)) !== claim.canonicalUrl ||
    String(source.onchain_id).toLowerCase() !== claim.onchainId?.toLowerCase() || claim.rssUrl && source.rss_url !== claim.rssUrl)
    throw new Error("Retained managed source identity is inactive, unverified or incompatible");
  return claim;
}
/** No DDL: retain seller original-policy evidence beside immutable economic authorization rows. */
export function admitSqliteSourceClaimPurchasePolicy(db: DatabaseSync, input: {
  identity: { network: string; payer: string; authorizationId: string }; existing: boolean;
  sourceId?: string; receipt?: SourceClaimReceipt; kind?: "fetch" | "citation" | "operating-fee"; payee: string; amountMicros: number; requestHash?: string;
}): void {
  if (!db.isTransaction) throw new Error("Atomic source claim purchase transaction required");
  assertSqliteSourceClaimSigningOriginal(db, input);
  const key = `purchase-policy:${digest(canonicalJson(input.identity))}`, original = read(db, key);
  const snapshot = input.sourceId ? { sourceId: input.sourceId, receipt: input.receipt ? sourceClaimReceiptSchema.parse(input.receipt) : null,
    kind: input.kind ?? "fetch" } : null;
  if (input.existing) {
    if (original && canonicalJson(original) !== canonicalJson(snapshot) || !original && input.receipt)
      throw new Error("Original research source claim policy conflict");
    if(input.kind === "operating-fee" && !original) throw new Error("Original operating fee purchase policy is unavailable");
    return;
  }
  if (original) throw new Error("Orphaned original research source claim policy");
  if (snapshot) {
    if(snapshot.kind !== "operating-fee") assertSqliteSourceClaimPaymentPolicy(db, { sourceId: snapshot.sourceId, expected: snapshot.receipt, kind: snapshot.kind, network: input.identity.network });
    put(db, key, snapshot, Date.now());
  }
}
/** x402's signed economic tuple does not sign URL query policy: bind it to any retained original. */
function assertSqliteSourceClaimSigningOriginal(db: DatabaseSync, input: {
  identity: { network: string; payer: string; authorizationId: string };
  sourceId?: string; receipt?: SourceClaimReceipt; kind?: "fetch" | "citation" | "operating-fee"; payee: string; amountMicros: number; requestHash?: string;
}): void {
  const exists = (name: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
  const policy = input.receipt ? sourceClaimReceiptSchema.parse(input.receipt) : null;
  if (exists("browser_authorization_intents") && exists("browser_journal_bindings")) {
    const row = db.prepare("SELECT i.*,b.* FROM browser_authorization_intents i LEFT JOIN browser_journal_bindings b USING(nonce) WHERE i.nonce=?")
      .get(input.identity.authorizationId);
    if (row) {
      if(input.kind === "operating-fee") throw new Error("Operating fee requires its original public hosted authorization");
      if (!row.payment_metadata) throw new Error("Original browser payment binding is unavailable");
      const metadata = JSON.parse(String(row.payment_metadata)), context = row.payment_context ? JSON.parse(String(row.payment_context)) : null;
      const originalPolicy = metadata.sourceClaim ?? null, contextPolicy = context?.sourceClaim ?? context?.item?.sourceClaim ?? null;
      if (row.network !== input.identity.network || String(row.signer).toLowerCase() !== input.identity.payer ||
        row.source_id !== input.sourceId || row.kind !== input.kind || String(row.payee).toLowerCase() !== input.payee ||
        row.amount_micro_usdc !== input.amountMicros || canonicalJson(originalPolicy) !== canonicalJson(policy) ||
        context && canonicalJson(contextPolicy) !== canonicalJson(originalPolicy))
        throw new Error("Seller source policy or economic tuple differs from the original browser authorization");
    }
  }
  if (exists("hosted_treasury_authorizations")) {
    const row = db.prepare("SELECT signer,original,policy_digest,submitted,header_hash FROM hosted_treasury_authorizations WHERE nonce=?").get(input.identity.authorizationId);
    if (row) {
      const original = JSON.parse(String(row.original)), context = original.context, message = original.payload?.message;
      if (!context || !message || input.identity.network !== "eip155:5042" || row.signer !== input.identity.payer ||
        context.sourceId !== input.sourceId || context.kind !== input.kind || String(message.to).toLowerCase() !== input.payee ||
        String(message.value) !== String(input.amountMicros) || canonicalJson(context.sourceClaim ?? null) !== canonicalJson(policy))
        throw new Error("Seller source policy or economic tuple differs from the original hosted authorization");
      if(input.kind === "operating-fee") {
        const fee = operatingFeeContextSchema.parse(context.operatingFee), admitted = db.prepare("SELECT data,role FROM hosted_treasury_policies WHERE digest=?").get(row.policy_digest);
        const treasury = hostedTreasuryPolicySchema.parse(admitted?.data ? JSON.parse(String(admitted.data)) : null);
        const retainedPolicy = db.prepare("SELECT value FROM sync_state WHERE key=?").get(OPERATING_FEE_POLICY_KEY_PREFIX + fee.policyDigest);
        const feePolicy = operatingFeePolicySchema.parse(retainedPolicy?.value ? JSON.parse(String(retainedPolicy.value)) : null);
        if(admitted?.role !== "public" || treasury.signer !== row.signer || treasury.origin !== new URL(config.baseUrl).origin ||
           operatingFeePolicyDigest(feePolicy) !== fee.policyDigest || canonicalJson(feePolicy) !== retainedPolicy?.value ||
           feePolicy.beneficiary !== input.payee || feePolicy.origin !== treasury.origin || feePolicy.network !== treasury.network ||
           feePolicy.storageIdentityDigest !== treasury.storageIdentityDigest ||
           input.sourceId !== OPERATING_FEE_SOURCE_ID || context.itemId !== null || context.privateJob !== null || policy !== null ||
           row.submitted !== 1 || typeof row.header_hash !== "string" || !/^0x[0-9a-f]{64}$/.test(row.header_hash) ||
           input.payee === row.signer || !Number.isSafeInteger(input.amountMicros) || input.amountMicros <= 0 ||
           input.requestHash !== operatingFeeRequestHash(context.queryId, fee) ||
           fee.amountMicroUsdc !== String(input.amountMicros) || BigInt(input.amountMicros) > BigInt(operatingFeeMaxMicroUsdc(context.queryBudgetMicroUsdc)))
          throw new Error("Operating fee seller terms differ from its original public hosted authorization");
      }
      return;
    }
  }
  if(input.kind === "operating-fee") throw new Error("Operating fee requires its original public hosted authorization");
}

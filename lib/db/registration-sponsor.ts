import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import { canonicalJson } from "../canonical-json";
import { canonicalSourceUrl, claimControlIsFresh, sourceClaimSchema } from "../sources/public-source-claim";
import {
  registrationIntentDigest, registrationPolicyDigest, activeRegistrationSponsorPolicySchema,
  registrationCreatorEligible, registrationPolicyExpired, registrationSponsorFundingObservationSchema,
  sponsoredRegistrationSchema, type ActiveRegistrationSponsorPolicy, type RegistrationSponsorFundingObservation, type SponsoredRegistration,
} from "../sources/registration-sponsor-protocol";

const PREFIX = "keryx:registration-sponsor:v1:";
const MAX_RECORDS = 1000;
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value.toLowerCase() as Address);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase() as Hex);
const timestamp = z.number().int().positive().max(8_640_000_000_000_000);
const state = sponsoredRegistrationSchema.shape.state;
const executionSchema = z.object({
  creatorSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform(value => value as Hex),
  signedTransaction: z.string().regex(/^0x02[0-9a-fA-F]+$/).max(32768).transform(value => value as Hex).optional(),
}).strict();
const lookupSchema = z.object({ wallet: address, id: hash.optional(), canonicalUrl: z.string().optional() })
  .strict().refine(value => value.id !== undefined || value.canonicalUrl !== undefined);
const transitionSchema = z.object({
  wallet: address, id: hash, expectedState: state, nextState: state,
  transactionNonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  transactionHash: hash.optional(), actualGasWei: z.string().regex(/^(0|[1-9]\d{0,77})$/).optional(),
  creatorSignature: executionSchema.shape.creatorSignature.optional(),
  signedTransaction: executionSchema.shape.signedTransaction,
  expiredResolution: z.literal(true).optional(),
  fundingObservation: registrationSponsorFundingObservationSchema.optional(),
  now: timestamp.optional(),
}).strict();
const entrySchema = z.object({ original: sponsoredRegistrationSchema, current: sponsoredRegistrationSchema,
  execution: executionSchema.optional() }).strict();
const policyEnvelopeSchema = z.object({ cohortDigest: hash, policyDigest: hash, policy: activeRegistrationSponsorPolicySchema }).strict();
type Entry = z.infer<typeof entrySchema>;
type PolicyEnvelope = z.infer<typeof policyEnvelopeSchema>;
export type RegistrationSponsorLookup = z.input<typeof lookupSchema>;
export type RegistrationSponsorTransition = z.input<typeof transitionSchema>;
/** Server-only bearer authority. Never include this in creator/API projections or logs. */
export type RegistrationSponsorExecution = z.infer<typeof executionSchema>;

/** Messages are safe for public API responses; storage details and submitted values stay private. */
export class RegistrationSponsorError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "registration_sponsor_conflict") {
    super(message); this.name = "RegistrationSponsorError";
  }
}
function conflict(message: string, code = "registration_sponsor_conflict"): never {
  throw new RegistrationSponsorError(message, 409, code);
}
function unavailable(): never {
  throw new RegistrationSponsorError("Registration sponsorship journal is unavailable", 503, "registration_sponsor_unavailable");
}
function parseInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) return conflict("Invalid registration sponsorship request", "registration_sponsor_invalid");
  return result.data;
}
function safeStorage<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) { if (error instanceof RegistrationSponsorError) throw error; return unavailable(); }
}
function atomic<T>(db: DatabaseSync, operation: () => T): T {
  return safeStorage(() => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); db.exec("COMMIT"); return result; }
    catch (error) { try { db.exec("ROLLBACK"); } catch { /* Preserve the original safe failure. */ } throw error; }
  });
}
function put(db: DatabaseSync, key: string, value: unknown, now: number): void {
  db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(PREFIX + key, canonicalJson(value), new Date(now).toISOString());
}
function cohortDigest(policy: ActiveRegistrationSponsorPolicy): string {
  return keccak256(toBytes(canonicalJson({ network: policy.network, deploymentOrigin: policy.deploymentOrigin,
    registryAddress: policy.registryAddress, sponsorAddress: policy.sponsorAddress,
    ...(policy.protocol === "keryx-registration-sponsor-v2" ? { protocol: policy.protocol } : {}) })));
}
function immutable(row: SponsoredRegistration): string {
  const mutable = new Set(["state", "updatedAt", "transactionHash", "transactionNonce", "actualGasWei", "expiredResolution"]);
  return canonicalJson(Object.fromEntries(Object.entries(row).filter(([key]) => !mutable.has(key))));
}
function sameRequestedIntent(original: SponsoredRegistration, requested: SponsoredRegistration): boolean {
  // Admission time is assigned by this journal, never by a client or a repeated prepare.
  return immutable({ ...requested, createdAt: original.createdAt }) === immutable(original);
}
function validateRow(row: SponsoredRegistration): void {
  if (row.expiredResolution && !["signing", "submitted", "confirmed", "reverted"].includes(row.state)) unavailable();
  if (!timestamp.safeParse(row.createdAt).success || !timestamp.safeParse(row.updatedAt).success ||
      !Number.isSafeInteger(row.claimRevision) || !Number.isSafeInteger(row.deadline) ||
      row.deadline > Math.floor(Number.MAX_SAFE_INTEGER / 1000) || row.updatedAt < row.createdAt ||
      (row.transactionNonce !== undefined && !Number.isSafeInteger(row.transactionNonce)) ||
      row.createdAt >= row.deadline * 1000 || (row.state === "expired" && row.updatedAt <= row.deadline * 1000) ||
      canonicalSourceUrl(row.canonicalUrl) !== row.canonicalUrl ||
      canonicalSourceUrl(row.rssUrl) !== row.rssUrl || new URL(row.rssUrl).origin !== new URL(row.canonicalUrl).origin ||
      row.params.urlHash !== keccak256(toBytes(row.canonicalUrl)) || row.params.payoutWallet !== row.creator ||
      row.onchainId !== keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [row.creator, row.params.urlHash])) ||
      row.id !== registrationIntentDigest(row)) unavailable();
  const unsigned = row.transactionNonce === undefined && row.transactionHash === undefined && row.actualGasWei === undefined;
  if ((["prepared", "expired"].includes(row.state) && !unsigned) ||
      (row.state === "signing" && (row.transactionNonce === undefined || row.transactionHash !== undefined || row.actualGasWei !== undefined)) ||
      (row.state === "submitted" && (row.transactionNonce === undefined || row.transactionHash === undefined || row.actualGasWei !== undefined)) ||
      (["confirmed", "reverted"].includes(row.state) && (row.transactionNonce === undefined || row.transactionHash === undefined ||
        row.actualGasWei === undefined || BigInt(row.actualGasWei) > BigInt(row.reservedWei)))) unavailable();
}
function validateBinding(row: SponsoredRegistration, policy: ActiveRegistrationSponsorPolicy): void {
  if (row.policyDigest !== registrationPolicyDigest(policy) || row.registryAddress !== policy.registryAddress || row.registryCodeHash !== policy.registryCodeHash ||
      row.relayer !== policy.sponsorAddress || `eip155:${row.chainId}` !== policy.network ||
      row.reservedWei !== policy.maxTransactionWei || !registrationCreatorEligible(policy, row.creator, row.canonicalUrl) ||
      (policy.protocol === "keryx-registration-sponsor-v1" ? row.deadline * 1000 > policy.expiresAt :
        row.deadline * 1000 > row.createdAt + 10 * 60_000)) unavailable();
}
function readPolicies(db: DatabaseSync): Map<string, PolicyEnvelope> {
  const rows = db.prepare("SELECT key,value FROM sync_state WHERE key LIKE ? ORDER BY key LIMIT 1001").all(PREFIX + "policy:%");
  if (rows.length > MAX_RECORDS) unavailable();
  const policies = new Map<string, PolicyEnvelope>();
  for (const stored of rows) {
    const envelope = policyEnvelopeSchema.parse(JSON.parse(String(stored.value)));
    if (String(stored.key) !== PREFIX + "policy:" + envelope.cohortDigest ||
        envelope.cohortDigest !== cohortDigest(envelope.policy) || envelope.policyDigest !== registrationPolicyDigest(envelope.policy) ||
        policies.has(envelope.policyDigest)) unavailable();
    policies.set(envelope.policyDigest, envelope);
  }
  return policies;
}
function readEntries(db: DatabaseSync, policies = readPolicies(db)): Entry[] {
  const rows = db.prepare("SELECT key,value FROM sync_state WHERE key LIKE ? ORDER BY key LIMIT 1001").all(PREFIX + "row:%");
  if (rows.length > MAX_RECORDS) unavailable();
  const entries: Entry[] = [], transactions = new Set<string>(), nonces = new Set<string>();
  let activeOriginals = 0;
  for (const stored of rows) {
    const entry = entrySchema.parse(JSON.parse(String(stored.value)));
    validateRow(entry.original); validateRow(entry.current);
    const policy = policies.get(entry.original.policyDigest)?.policy;
    if (!policy || String(stored.key) !== PREFIX + "row:" + entry.original.id || entry.original.state !== "prepared" ||
        entry.original.createdAt !== entry.original.updatedAt || immutable(entry.original) !== immutable(entry.current) ||
        entry.current.updatedAt < entry.original.updatedAt) unavailable();
    validateBinding(entry.original, policy); validateBinding(entry.current, policy);
    if (entry.execution) {
      const { state, transactionHash } = entry.current;
      if (["prepared", "expired"].includes(state) ||
          (state === "signing" && entry.execution.signedTransaction !== undefined) ||
          (["submitted", "confirmed", "reverted"].includes(state) &&
            (!entry.execution.signedTransaction || keccak256(entry.execution.signedTransaction) !== transactionHash))) unavailable();
    }
    if (["signing", "submitted"].includes(entry.current.state) && ++activeOriginals > 1) unavailable();
    if (entry.current.transactionHash !== undefined) {
      if (transactions.has(entry.current.transactionHash)) unavailable();
      transactions.add(entry.current.transactionHash);
    }
    if (entry.current.transactionNonce !== undefined) {
      const nonce = `${entry.current.chainId}:${entry.current.relayer}:${entry.current.transactionNonce}`;
      if (nonces.has(nonce)) unavailable();
      nonces.add(nonce);
    }
    entries.push(entry);
  }
  const lineages = new Map<string, Entry[]>();
  for (const entry of entries) {
    const lineage = lineages.get(entry.current.canonicalUrl) ?? [];
    lineage.push(entry); lineages.set(entry.current.canonicalUrl, lineage);
  }
  for (const lineage of lineages.values()) {
    lineage.sort((a, b) => a.original.createdAt - b.original.createdAt);
    for (let index = 0; index < lineage.length; index++) {
      const row = lineage[index].original;
      if (index === 0) {
        if (row.replacesRequestId !== undefined) unavailable();
      } else {
        const previous = lineage[index - 1].current;
        if (row.replacesRequestId !== previous.id || !mayRenew(previous, row, row.createdAt,
          policies.get(previous.policyDigest)?.policy, policies.get(row.policyDigest)?.policy)) unavailable();
      }
    }
  }
  return entries;
}
function mayRenew(previous: SponsoredRegistration, requested: SponsoredRegistration, now: number,
  previousPolicy?: ActiveRegistrationSponsorPolicy, requestedPolicy?: ActiveRegistrationSponsorPolicy): boolean {
  const terminal = previous.state === "reverted" && previous.transactionHash !== undefined && previous.actualGasWei !== undefined ||
    previous.state === "expired" && previous.transactionNonce === undefined && previous.transactionHash === undefined && previous.actualGasWei === undefined;
  const samePolicy = previous.policyDigest === requested.policyDigest;
  const explicitUpgrade = previousPolicy?.protocol === "keryx-registration-sponsor-v1" &&
    requestedPolicy?.protocol === "keryx-registration-sponsor-v2" && previousPolicy.deploymentOrigin === requestedPolicy.deploymentOrigin &&
    previous.chainId === requested.chainId && previous.relayer === requested.relayer && previous.registryAddress === requested.registryAddress &&
    previous.registryCodeHash === requested.registryCodeHash && previous.rssUrl === requested.rssUrl;
  return terminal && previous.creator === requested.creator && (samePolicy || explicitUpgrade) &&
    previous.canonicalUrl === requested.canonicalUrl && previous.claimId === requested.claimId && previous.sourceId === requested.sourceId &&
    previous.id !== requested.id && requested.replacesRequestId === previous.id && now > previous.createdAt &&
    (previous.state === "reverted" || now >= (previous.deadline + 1) * 1000) && previous.updatedAt <= now;
}
function assertLiveClaim(db: DatabaseSync, row: SponsoredRegistration, policy: ActiveRegistrationSponsorPolicy, now: number): void {
  const saved = db.prepare("SELECT value FROM sync_state WHERE key=?").get("keryx:source-claims:v1:claim:" + row.claimId);
  const parsed = sourceClaimSchema.safeParse(saved ? JSON.parse(String(saved.value)) : null);
  if (!parsed.success) conflict("Publishing-control proof is unavailable; retain this registration original", "registration_sponsor_proof_changed");
  const claim = parsed.data;
  if (claim.id !== row.claimId || claim.ownerWallet !== row.creator || claim.revision !== row.claimRevision ||
      claim.canonicalUrl !== row.canonicalUrl || claim.rssUrl !== row.rssUrl || claim.linkedSourceId !== row.sourceId ||
      claim.onchainId?.toLowerCase() !== row.onchainId || claim.registryAddress !== row.registryAddress ||
      claim.network !== policy.network || claim.deploymentOrigin !== policy.deploymentOrigin || !claimControlIsFresh(claim, now) ||
      !["website-file", "rss-channel"].includes(claim.proofMethod ?? ""))
    conflict("Publishing-control proof changed; retain this registration original", "registration_sponsor_proof_changed");
}
function saveEntry(db: DatabaseSync, entry: Entry, now: number): SponsoredRegistration {
  validateRow(entry.current);
  put(db, "row:" + entry.current.id, entry, now);
  return entry.current;
}
function expired(row: SponsoredRegistration, now: number): boolean { return row.state === "prepared" && now > row.deadline * 1000; }
function expirePrepared(db: DatabaseSync, entries: Entry[], now: number): void {
  for (const entry of entries) if (expired(entry.current, now)) {
    entry.current = { ...entry.current, state: "expired", updatedAt: Math.max(now, entry.current.updatedAt) };
    saveEntry(db, entry, now);
  }
}
function heldWei(row: SponsoredRegistration): bigint {
  if (row.state === "expired") return BigInt(0);
  return BigInt(row.actualGasWei ?? row.reservedWei);
}
const day = (at: number): string => new Date(at).toISOString().slice(0, 10);

export interface RegistrationSponsorFundingInspection {
  available: boolean; reservedGasCovered: boolean; heldWei: string; spendableWei: string;
}
function fundingUnavailable(): never {
  throw new RegistrationSponsorError("Fresh sponsor funds could not be verified", 503, "registration_sponsor_rpc_unavailable");
}
/** Balance and nonce share one fresh attested block; liability spans all immutable policies. */
function inspectFunding(entries: Entry[], policy: ActiveRegistrationSponsorPolicy,
  value: RegistrationSponsorFundingObservation | undefined, now: number): RegistrationSponsorFundingInspection {
  const parsed = registrationSponsorFundingObservationSchema.safeParse(value);
  if (!parsed.success) fundingUnavailable();
  const observation = parsed.data;
  if (observation.network !== policy.network || observation.sponsorAddress !== policy.sponsorAddress ||
      observation.observedAt > now || now - observation.observedAt > 5_000 ||
      observation.blockTimestamp * 1000 > now + 5_000 || observation.blockTimestamp * 1000 < now - 60_000)
    fundingUnavailable();
  const rows = entries.map(entry => entry.current).filter(row => `eip155:${row.chainId}` === policy.network && row.relayer === policy.sponsorAddress);
  // A receipt released after an older snapshot must not expose its pre-spend balance again.
  if (rows.some(row => ["confirmed", "reverted"].includes(row.state) &&
      row.transactionNonce! >= observation.latestTransactionNonce)) fundingUnavailable();
  const held = rows.reduce((sum, row) => sum + (["signing", "submitted"].includes(row.state) ||
    row.state === "prepared" && !expired(row, now) ? BigInt(row.reservedWei) : BigInt(0)), BigInt(0));
  const balance = BigInt(observation.nativeBalanceWei), spendable = balance > held ? balance - held : BigInt(0);
  return { available: balance >= held && spendable >= BigInt(policy.maxTransactionWei), reservedGasCovered: held > BigInt(0) && balance >= held,
    heldWei: held.toString(), spendableWei: spendable.toString() };
}
function requireFundedHold(entries: Entry[], policy: ActiveRegistrationSponsorPolicy,
  observation: RegistrationSponsorFundingObservation | undefined, now: number, newHold: boolean, transactionNonce?: number): void {
  const inspection = inspectFunding(entries, policy, observation, now);
  if (transactionNonce !== undefined && observation!.latestTransactionNonce !== transactionNonce) fundingUnavailable();
  const covered = newHold ? inspection.available : BigInt(observation!.nativeBalanceWei) >= BigInt(inspection.heldWei);
  if (!covered) conflict("The sponsor wallet cannot cover this registration's full gas hold", "registration_sponsor_insufficient_funds");
}
/** Read-only discovery cannot reserve gas or release an uncertain signed original. */
export function inspectSqliteRegistrationSponsorFunding(db: DatabaseSync, policyValue: ActiveRegistrationSponsorPolicy,
  observation: RegistrationSponsorFundingObservation, now = Date.now()): RegistrationSponsorFundingInspection {
  const policy = parseInput(activeRegistrationSponsorPolicySchema, policyValue); parseInput(timestamp, now);
  return safeStorage(() => {
    db.exec("BEGIN");
    try { const result = inspectFunding(readEntries(db), policy, observation, now); db.exec("COMMIT"); return result; }
    catch (error) { try { db.exec("ROLLBACK"); } catch { /* Retain the safe observation failure. */ } throw error; }
  });
}

/** Atomically retain one original and its maximum gas liability before any sponsor signing. */
export function admitSqliteRegistrationSponsor(db: DatabaseSync, policyValue: ActiveRegistrationSponsorPolicy,
  rowValue: SponsoredRegistration, now = Date.now(), fundingObservation?: RegistrationSponsorFundingObservation): SponsoredRegistration {
  const policy = parseInput(activeRegistrationSponsorPolicySchema, policyValue);
  const requested = parseInput(sponsoredRegistrationSchema, rowValue);
  parseInput(timestamp, now);
  try { validateRow(requested); validateBinding(requested, policy); }
  catch { conflict("Registration intent does not match the sponsor policy", "registration_sponsor_invalid"); }
  if (requested.state !== "prepared") conflict("Only a new prepared registration can be admitted", "registration_sponsor_invalid");
  return atomic(db, () => {
    const policies = readPolicies(db), digest = registrationPolicyDigest(policy), cohort = cohortDigest(policy);
    const pinned = [...policies.values()].find(value => value.cohortDigest === cohort);
    if (pinned && pinned.policyDigest !== digest) conflict("The original sponsor policy cannot be replaced", "registration_sponsor_policy_changed");
    const entries = readEntries(db, policies);
    const byId = entries.find(entry => entry.current.id === requested.id);
    const latest = entries.filter(entry => entry.current.canonicalUrl === requested.canonicalUrl)
      .sort((a, b) => b.original.createdAt - a.original.createdAt)[0];
    if (byId || latest && requested.replacesRequestId === undefined) {
      const original = byId ?? latest;
      if (!sameRequestedIntent(original.original, requested)) conflict("This source already retains a different registration original", "registration_sponsor_original_conflict");
      expirePrepared(db, [original], now); return original.current;
    }
    if (registrationPolicyExpired(policy, now) || requested.deadline * 1000 <= now)
      conflict("Registration sponsorship authority has expired", "registration_sponsor_expired");
    if (policy.protocol === "keryx-registration-sponsor-v2" && requested.deadline * 1000 > now + 10 * 60_000)
      conflict("Registration authorization must expire within ten minutes", "registration_sponsor_invalid");
    if (entries.length >= MAX_RECORDS || (!pinned && policies.size >= MAX_RECORDS))
      conflict("Registration sponsorship inspection limit reached", "registration_sponsor_limit");
    expirePrepared(db, entries, now);
    if (requested.replacesRequestId !== undefined && (!latest || !mayRenew(latest.current, requested, now,
      policies.get(latest.current.policyDigest)?.policy, policy)))
      conflict("Only the latest expired unsigned or receipt-reverted original may be renewed", "registration_sponsor_renewal_refused");
    if (entries.some(entry => entry.current.creator === requested.creator &&
        ["prepared", "signing", "submitted"].includes(entry.current.state)))
      conflict("This creator already has an original registration awaiting completion", "registration_sponsor_creator_busy");
    const cohortRows = entries.filter(entry => entry.current.policyDigest === digest).map(entry => entry.current);
    const today = cohortRows.filter(row => day(row.createdAt) === day(now));
    const reservation = BigInt(policy.maxTransactionWei);
    if (policy.protocol === "keryx-registration-sponsor-v2") {
      assertLiveClaim(db, requested, policy, now);
      requireFundedHold(entries, policy, fundingObservation, now, true);
    }
    else if (cohortRows.length >= policy.maxRegistrationsTotal || today.length >= policy.maxRegistrationsPerDay ||
        cohortRows.filter(row => row.creator === requested.creator).length >= policy.maxRegistrationsPerWallet ||
        (policy.maxRegistrationsPerOrigin !== undefined && cohortRows.filter(row => new URL(row.canonicalUrl).origin === new URL(requested.canonicalUrl).origin).length >= policy.maxRegistrationsPerOrigin) ||
        cohortRows.reduce((sum, row) => sum + heldWei(row), BigInt(0)) + reservation > BigInt(policy.maxLifetimeWei) ||
        today.reduce((sum, row) => sum + heldWei(row), BigInt(0)) + reservation > BigInt(policy.maxDailyWei))
      conflict("Registration sponsorship allowance is exhausted", "registration_sponsor_limit");
    if (!pinned) put(db, "policy:" + cohort, { cohortDigest: cohort, policyDigest: digest, policy }, now);
    const admitted = { ...requested, createdAt: now, updatedAt: now };
    return saveEntry(db, { original: admitted, current: admitted }, now);
  });
}

/** Owner recovery is read-only and independent of the currently configured or expired policy. */
export function getSqliteRegistrationSponsor(db: DatabaseSync, input: RegistrationSponsorLookup): SponsoredRegistration | null {
  const lookup = parseInput(lookupSchema, input);
  let canonicalUrl: string | undefined;
  try { canonicalUrl = lookup.canonicalUrl === undefined ? undefined : canonicalSourceUrl(lookup.canonicalUrl); }
  catch { conflict("Invalid registration source URL", "registration_sponsor_invalid"); }
  return safeStorage(() => {
    db.exec("BEGIN");
    try {
      const row = readEntries(db).filter(entry => entry.current.creator === lookup.wallet &&
        (lookup.id === undefined || entry.current.id === lookup.id) &&
        (canonicalUrl === undefined || entry.current.canonicalUrl === canonicalUrl))
        .sort((a, b) => b.original.createdAt - a.original.createdAt)[0]?.current ?? null;
      db.exec("COMMIT"); return row;
    } catch (error) { try { db.exec("ROLLBACK"); } catch { /* Retain the safe original failure. */ } throw error; }
  });
}

/** Read private execution authority separately from the public original. Legacy originals lack it. */
export function getSqliteRegistrationSponsorExecution(db: DatabaseSync, input: { wallet: string; id: string }): RegistrationSponsorExecution | null {
  const lookup = parseInput(lookupSchema, input);
  return safeStorage(() => {
    db.exec("BEGIN");
    try {
      const execution = readEntries(db).find(entry => entry.current.creator === lookup.wallet && entry.current.id === lookup.id)?.execution ?? null;
      db.exec("COMMIT"); return execution;
    } catch (error) { try { db.exec("ROLLBACK"); } catch { /* Preserve the original safe failure. */ } throw error; }
  });
}

/** Resuming execution never changes the admitted transaction nonce or gas reservation. */
export function transitionSqliteRegistrationSponsor(db: DatabaseSync, input: RegistrationSponsorTransition): SponsoredRegistration {
  const change = parseInput(transitionSchema, input), now = change.now ?? Date.now();
  parseInput(timestamp, now);
  return atomic(db, () => {
    const policies = readPolicies(db), entries = readEntries(db, policies);
    const entry = entries.find(value => value.current.id === change.id && value.current.creator === change.wallet);
    if (!entry) conflict("Original registration is unavailable for this wallet", "registration_sponsor_original_missing");
    const row = entry.current;
    if (change.creatorSignature !== undefined && !(row.state === "prepared" && change.nextState === "signing") ||
        change.signedTransaction !== undefined && !(row.state === "signing" && change.nextState === "submitted"))
      conflict("Execution authority can only be retained with its original transition");
    if (change.expiredResolution && !(row.state === change.nextState && ["signing", "submitted"].includes(row.state)))
      conflict("Expired resolution must retain an unresolved original");
    if (row.state !== change.expectedState || now < row.updatedAt)
      conflict("Original registration state changed; read it before continuing", "registration_sponsor_state_changed");
    const proofMatches = (change.transactionNonce === undefined || change.transactionNonce === row.transactionNonce) &&
      (change.transactionHash === undefined || change.transactionHash === row.transactionHash);
    if (row.state === "prepared" && change.nextState === "expired") {
      if (!expired(row, now) || change.transactionNonce !== undefined || change.transactionHash !== undefined || change.actualGasWei !== undefined)
        conflict("Only an expired unsigned registration can release its gas hold");
    } else if (row.state === "prepared" && change.nextState === "signing") {
      const policy = policies.get(row.policyDigest)!.policy;
      if (expired(row, now) || registrationPolicyExpired(policy, now)) conflict("Registration sponsorship authority has expired", "registration_sponsor_expired");
      if (change.transactionNonce === undefined || change.transactionHash !== undefined || change.actualGasWei !== undefined)
        conflict("Sponsor signing requires its original transaction nonce");
      if (entries.some(value => value.current.state === "signing" || value.current.state === "submitted"))
        conflict("Another original sponsor transaction still needs reconciliation", "registration_sponsor_busy");
      if (entries.some(value => value.current.chainId === row.chainId && value.current.relayer === row.relayer &&
        value.current.transactionNonce === change.transactionNonce)) conflict("The sponsor transaction nonce already has an original");
      assertLiveClaim(db, row, policy, now);
      if (policy.protocol === "keryx-registration-sponsor-v2") requireFundedHold(entries, policy, change.fundingObservation, now, false, change.transactionNonce);
    } else if (row.state === "signing" && change.nextState === "submitted") {
      if (change.transactionHash === undefined || change.actualGasWei !== undefined ||
          (change.transactionNonce !== undefined && change.transactionNonce !== row.transactionNonce))
        conflict("Submission must retain the original sponsor transaction");
      if (entries.some(value => value.current.transactionHash === change.transactionHash)) conflict("The transaction hash already has an original");
      if (entry.execution && (!change.signedTransaction || keccak256(change.signedTransaction) !== change.transactionHash))
        conflict("Submission must retain the exact signed original before broadcast");
    } else if (row.state === change.nextState && ["signing", "submitted"].includes(row.state)) {
      const policy = policies.get(row.policyDigest)!.policy;
      const resolvingExpired = change.expiredResolution === true;
      if (!entry.execution || !proofMatches || change.actualGasWei !== undefined || registrationPolicyExpired(policy, now) ||
          (resolvingExpired ? now <= row.deadline * 1000 : now > row.deadline * 1000 || row.expiredResolution))
        conflict("The original execution authority cannot be resumed");
      if (!resolvingExpired) assertLiveClaim(db, row, policy, now);
      if (policy.protocol === "keryx-registration-sponsor-v2") requireFundedHold(entries, policy, change.fundingObservation, now, false, row.transactionNonce);
    } else if (row.state === "submitted" && ["confirmed", "reverted"].includes(change.nextState)) {
      if (!proofMatches || change.actualGasWei === undefined || BigInt(change.actualGasWei) > BigInt(row.reservedWei))
        conflict("Finality evidence must match the original reserved transaction");
    } else conflict("The original registration cannot make this transition", "registration_sponsor_transition_refused");
    entry.current = { ...row, state: change.nextState, updatedAt: now,
      ...(change.transactionNonce === undefined ? {} : { transactionNonce: change.transactionNonce }),
      ...(change.transactionHash === undefined ? {} : { transactionHash: change.transactionHash }),
      ...(change.actualGasWei === undefined ? {} : { actualGasWei: change.actualGasWei }),
      ...(change.expiredResolution ? { expiredResolution: true as const } : {}),
    };
    if (change.creatorSignature) entry.execution = { creatorSignature: change.creatorSignature };
    if (change.signedTransaction) {
      if (!entry.execution) conflict("Signed execution needs its retained creator authorization");
      entry.execution = { ...entry.execution, signedTransaction: change.signedTransaction };
    }
    return saveEntry(db, entry, now);
  });
}

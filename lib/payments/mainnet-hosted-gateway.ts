import { createHash } from "node:crypto";
import { z } from "zod";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { applicationStorageIdentity, assertApplicationStorageCurrentLocal } from "../db/application-storage";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";
import type { StorageIdentity } from "../db/storage-identity";
import { hostedPaymentContextSchema } from "../db/hosted-treasury-journal";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { configuredHostedTreasuryPolicy, type HostedTreasuryPolicy } from "./hosted-treasury-policy";
import { ServerPaymentGateway, paymentFromAttempt, checkJournalOutcome, throwIfDeliveryFailed, type PaymentJournalContext } from "./server-payment-gateway";
import { configuredOperatingFeePolicy, operatingFeeContextSchema, operatingFeePolicyDigest, operatingFeeEndpointPath, OPERATING_FEE_SOURCE_ID, type OperatingFeeContext } from "./operating-fee-policy";
import { payWithServerSigner } from "./server-x402-client";
import { createPinnedArcBatchSigner } from "./pinned-arc-batch-signer";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";
import type { BatchPayloadSigner } from "./server-x402-client";
import { privateCreatorJournal } from "./private-creator-journal";
import { assertArcRpcChain } from "../arc-rpc-attestation";
import { configuredResearchAllowance } from "../research/research-allowance";

function exactBudget(value: number) {
  const amount = Math.round(value * 1e6);
  if (!Number.isSafeInteger(amount) || amount <= 0 || value !== amount / 1e6) throw new Error("Hosted budget unavailable");
  return String(amount);
}
type Role = "public" | "private";
type HostedFrame = Readonly<{ identity: Readonly<StorageIdentity>; selection: string; baseUrl: string; rpcUrl: string;
  maxTimeoutSeconds: number; policy: HostedTreasuryPolicy; role: Role }>;
const keyName = (role: Role) => role === "private" ? "KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY" : "KERYX_MAINNET_TREASURY_PRIVATE_KEY";
function origin() {
  let url: URL; try { url = new URL(config.baseUrl); } catch { throw new Error("Hosted origin unavailable"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Hosted origin unavailable");
  return url.origin;
}
function localPolicy(db: KeryxDB, frame: HostedFrame) {
  assertApplicationStorageCurrentLocal(db, "write");
  if (config.profile !== ARC_MAINNET_PROFILE || process.env.KERYX_FORCE_OFFLINE === "1" || config.baseUrl !== frame.baseUrl
    || config.rpcUrl !== frame.rpcUrl || config.maxTimeoutSeconds !== frame.maxTimeoutSeconds
    || canonicalJson(readRuntimeStorageDeployment()) !== frame.selection) throw new Error("Hosted policy changed");
  const current = configuredHostedTreasuryPolicy(frame.identity, origin(), frame.role);
  if (canonicalJson(current) !== canonicalJson(frame.policy)) throw new Error("Hosted policy changed");
  return current;
}
async function hostedFrame(db: KeryxDB, role: Role): Promise<HostedFrame> {
  if (config.profile !== ARC_MAINNET_PROFILE || process.env.KERYX_FORCE_OFFLINE === "1" || !["public", "private"].includes(role))
    throw new Error("Hosted mainnet authority unavailable");
  const selected = readRuntimeStorageDeployment();
  // Generic application provenance also supports Supabase. Hosted custody does not.
  if (selected.backend.kind !== "sqlite" && selected.backend.kind !== "postgres") throw new Error("Hosted mainnet authority unavailable");
  const selection = canonicalJson(selected), baseUrl = config.baseUrl, rpcUrl = config.rpcUrl, maxTimeoutSeconds = config.maxTimeoutSeconds;
  const selectedPolicy = configuredHostedTreasuryPolicy(selected.identity, origin(), role);
  const identity = await applicationStorageIdentity(db, "write");
  if (canonicalJson(identity) !== canonicalJson(selected.identity)) throw new Error("Hosted policy changed");
  const frame = Object.freeze({ identity, selection, baseUrl, rpcUrl, maxTimeoutSeconds, role, policy: selectedPolicy });
  localPolicy(db, frame); return frame;
}
function custodyFingerprint(frame: HostedFrame) {
  try {
    const key = process.env[keyName(frame.role)];
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || privateKeyToAddress(key as `0x${string}`).toLowerCase() !== frame.policy.signer) throw new Error();
    return createHash("sha256").update(key).digest("hex");
  } catch { throw new Error("Dedicated hosted mainnet custody unavailable"); }
}
function narrowCustody(db: KeryxDB, frame: HostedFrame, fingerprint: string) {
  localPolicy(db, frame);
  if (custodyFingerprint(frame) !== fingerprint) throw new Error("Dedicated hosted mainnet custody changed");
}
export async function mainnetHostedPolicy(db: KeryxDB, role: Role = "public") {
  const frame = await hostedFrame(db, role); return localPolicy(db, frame);
}
/** Address comparison and historical role proof; no signer or funding. */
export async function assertMainnetHostedCustodyReady(db: KeryxDB, role: Role = "public") {
  const frame = await hostedFrame(db, role); localPolicy(db, frame);
  const fingerprint = custodyFingerprint(frame);
  await db.hostedTreasuryAccounting(frame.policy.signer, role);
  narrowCustody(db, frame, fingerprint); return frame.policy;
}
/** Pre-purchase custody/capacity check. Never signs, reserves, funds or transacts. */
export async function assertMainnetHostedResearchReady(db: KeryxDB, budgetMicros: string, role: Role = "public") {
  if (configuredResearchAllowance()) throw new Error("Paid research admission is paused during bounded browser acceptance; original records remain recoverable");
  if (!/^[1-9][0-9]{0,15}$/.test(budgetMicros) || BigInt(budgetMicros) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Hosted budget unavailable");
  const frame = await hostedFrame(db, role); localPolicy(db, frame);
  const policy = frame.policy, fingerprint = custodyFingerprint(frame), budget = BigInt(budgetMicros);
  if (budget > BigInt(policy.queryCapMicroUsdc)) throw new Error("Hosted operating configuration unavailable");
  const before = await db.hostedTreasuryAccounting(policy.signer, role); narrowCustody(db, frame, fingerprint);
  await assertArcRpcChain(frame.rpcUrl, ARC_MAINNET_PROFILE); narrowCustody(db, frame, fingerprint);
  const available = await getGatewayAvailableAtomic(policy.signer, ARC_MAINNET_PROFILE); narrowCustody(db, frame, fingerprint);
  if (available === null || BigInt(before.retainedMicroUsdc) + budget > BigInt(policy.lifetimeCapMicroUsdc)
    || BigInt(before.retainedMicroUsdc) - BigInt(before.confirmedMicroUsdc) + budget > available) throw new Error("Hosted current capacity unavailable");
  const after = await db.hostedTreasuryAccounting(policy.signer, role); narrowCustody(db, frame, fingerprint);
  if (canonicalJson(before) !== canonicalJson(after)) throw new Error("Hosted current capacity unavailable");
}
/** Only genuine selected provenance and durable admission may reach the role key. */
export async function createMainnetHostedGateway(db: KeryxDB, options: {
  role?: Role; job?: { id: string; owner: string; workerId: string };
} = {}) {
  const role = options.role ?? "public", rawJob = options.job;
  const job = rawJob === undefined ? undefined : Object.freeze(z.object({ id: z.string().min(1).max(256),
    owner: z.string().regex(/^0x[0-9a-f]{40}$/), workerId: z.string().min(1).max(256) }).strict().parse(rawJob));
  if ((role === "private") !== !!job) throw new Error("Hosted role requires its original execution job");
  const frame = await hostedFrame(db, role); localPolicy(db, frame);
  const policy = frame.policy;
  if (role === "private") {
    const publicPolicy = await mainnetHostedPolicy(db); localPolicy(db, frame);
    if (canonicalJson(configuredHostedTreasuryPolicy(frame.identity, origin(), "public")) !== canonicalJson(publicPolicy)) throw new Error("Hosted policy changed");
    if (policy.signer === publicPolicy.signer) throw new Error("Private and public hosted custody must remain distinct");
  }
  await db.admitHostedTreasuryPolicy(policy, role); localPolicy(db, frame);
  // Read this separately named key only after actual sealed policy admission.
  const fingerprint = custodyFingerprint(frame), key = process.env[keyName(role)]!;
  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    if (account.address.toLowerCase() !== policy.signer) throw new Error();
    narrowCustody(db, frame, fingerprint);
    return new MainnetHostedGateway(db, account, frame, fingerprint, job);
  } catch { throw new Error("Dedicated hosted mainnet custody unavailable"); }
}

class MainnetHostedGateway extends ServerPaymentGateway {
  protected spend: { address: string };
  protected batchScheme: BatchPayloadSigner = { createPaymentPayload: async () => { throw new Error("Hosted signing requires an original payment context"); } };
  private budget?: string;
  constructor(private readonly db: KeryxDB, private readonly account: PrivateKeyAccount,
    private readonly frame: HostedFrame, private readonly keyFingerprint: string, private readonly job?: { id: string; owner: string; workerId: string }) {
    super(); const { policy, role } = frame; this.spend = { address: policy.signer };
    this.paymentJournal = context => {
      if (context.kind === "operating-fee" && (role !== "public" || job)) throw new Error("Operating fees require public hosted authority");
      if (job && context.queryId !== job.id) throw new Error("Hosted private authority belongs to another job");
      const privateJournal = job && context.kind !== "operating-fee" ? privateCreatorJournal(db, { id: job.id, payer: job.owner, workerId: job.workerId,
        kind: context.kind, sourceId: context.sourceId, itemId: context.itemId }) : null;
      let nonce: string | undefined;
      return {
        beforeSubmit: async submission => { await privateJournal?.beforeSubmit(submission); },
        beforeSignedSubmit: async (submission, hash) => {
          await this.assertPolicy(); this.assertLocal(); nonce = submission.authorizationId;
          await db.submitHostedAuthorization(policy.signer, submission, hash);
          this.assertLocal();
        },
        recordOutcome: async value => {
          const attempt = { ...value }; // Retain observed settlement across asynchronous persistence failure.
          const extra = await privateJournal?.recordOutcome(attempt);
          let status: "pending" | "confirmed" | "confirmation-unpersisted" = "pending";
          if (nonce && attempt.authorizationId.toLowerCase() === nonce && attempt.settlementStatus === "settled" && attempt.transaction) {
            try { await db.confirmHostedAuthorization(policy.signer, nonce, attempt.transaction); status = "confirmed"; }
            catch { status = "confirmation-unpersisted"; }
          }
          return extra ?? { attempt: { ...attempt, authorizationPhase: attempt.settlementStatus === "settled" ? "settled" : "submission_attempted" }, confirmation: null, journalStatus: status };
        },
      };
    };
  }
  private get policy() { return this.frame.policy; }
  private get role() { return this.frame.role; }
  private assertLocal() { narrowCustody(this.db, this.frame, this.keyFingerprint); }
  private async assertPolicy() {
    this.assertLocal();
    const identity = await applicationStorageIdentity(this.db, "write");
    this.assertLocal();
    if (canonicalJson(identity) !== canonicalJson(this.frame.identity)) throw new Error("Hosted policy changed");
  }
  async operatingFeePolicy() {
    await this.assertPolicy(); this.assertLocal();
    if (this.role !== "public" || this.job) throw new Error("Operating fees require public hosted authority");
    return configuredOperatingFeePolicy(this.frame.identity, this.policy.origin, this.policy.signer);
  }
  async payOperatingFee(args: { queryId: string; operatingFee: OperatingFeeContext }) {
    const queryId = args.queryId, fee = operatingFeeContextSchema.parse(args.operatingFee);
    const policy = await this.operatingFeePolicy(); this.assertLocal();
    if (fee.policyDigest !== operatingFeePolicyDigest(policy)) throw new Error("Operating fee policy changed");
    const context: PaymentJournalContext = { queryId, kind: "operating-fee", sourceId: OPERATING_FEE_SOURCE_ID, itemId: null, operatingFee: fee };
    const journal = this.paymentJournal!(context), amount = Number(fee.amountMicroUsdc) / 1e6;
    const attempt = await payWithServerSigner<{ ok?: boolean }>({ url: `${config.baseUrl}${operatingFeeEndpointPath(queryId, fee)}`, method: "POST",
      expectedPayee: policy.beneficiary, expectedAmount: amount, payer: this.policy.signer,
      signer: this.signerForPayment(context), beforeSubmit: journal.beforeSubmit, beforeSignedSubmit: journal.beforeSignedSubmit });
    const outcome = await journal.recordOutcome(attempt);
    const observed = outcome.attempt ?? attempt;
    const payment = paymentFromAttempt(observed, { kind: "operating-fee", queryId,
      sourceId: OPERATING_FEE_SOURCE_ID, sourceName: "Keryx operating fee", payer: this.policy.signer, payee: policy.beneficiary,
      settledRationale: "Keryx operating fee for evidence-qualified unclaimed public citations." });
    checkJournalOutcome(outcome.journalStatus, payment, observed);
    throwIfDeliveryFailed(observed, payment, "Keryx operating service");
    return payment;
  }
  protected signerForPayment(context: PaymentJournalContext) {
    this.assertLocal();
    if (!this.budget) throw new Error("Hosted query budget not admitted");
    const queryBudgetMicroUsdc = this.budget;
    // Zod copies every nested Source claim/fee/job field before any asynchronous work.
    const detached = { ...context };
    const captured = hostedPaymentContextSchema.parse({ ...detached, queryBudgetMicroUsdc,
      privateJob: detached.kind === "operating-fee" ? null : this.job ?? null });
    if (this.job && captured.queryId !== this.job.id) throw new Error("Hosted private authority belongs to another job");
    const contextWire = canonicalJson(captured);
    const payloadWire = (value: unknown) => canonicalJson(JSON.parse(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? String(v) : v)));
    let admittedPayload: string | undefined;
    return createPinnedArcBatchSigner(this.account, this.frame.rpcUrl, ARC_MAINNET_PROFILE, this.frame.maxTimeoutSeconds, async payload => {
      await this.assertPolicy(); this.assertLocal();
      const before = await this.db.hostedTreasuryAccounting(this.policy.signer, this.role); this.assertLocal();
      const available = await getGatewayAvailableAtomic(this.policy.signer, ARC_MAINNET_PROFILE); this.assertLocal();
      if (available === null) throw new Error("Hosted prefunded balance unavailable");
      const wire = payloadWire(payload), nonce = String(payload.message.nonce).toLowerCase();
      const result = await this.db.admitHostedAuthorization({ policy: this.policy, context: structuredClone(captured),
        payload, accounting: before, availableMicroUsdc: String(available) });
      this.assertLocal();
      if (result !== nonce || payloadWire(payload) !== wire || canonicalJson(captured) !== contextWire || this.budget !== queryBudgetMicroUsdc)
        throw new Error("Hosted original admission changed");
      admittedPayload = wire;
    }, payload => {
      // No awaits after the final RPC: this narrows existing admission, never issues proof.
      this.assertLocal();
      if (this.budget !== queryBudgetMicroUsdc || canonicalJson(captured) !== contextWire || admittedPayload !== payloadWire(payload))
        throw new Error("Hosted original admission changed");
      if (captured.kind === "operating-fee" && operatingFeePolicyDigest(configuredOperatingFeePolicy(this.frame.identity,
        this.policy.origin, this.policy.signer)) !== captured.operatingFee.policyDigest) throw new Error("Operating fee policy changed");
      admittedPayload = undefined; // Consume this exact completed admission before key invocation.
    });
  }
  async ensureFunded(budget: number) {
    const micros = exactBudget(budget);
    await this.assertPolicy(); this.assertLocal();
    if (this.budget && micros !== this.budget || BigInt(micros) > BigInt(this.policy.queryCapMicroUsdc)) throw new Error("Hosted query budget refused");
    const before = await this.db.hostedTreasuryAccounting(this.policy.signer, this.role); this.assertLocal();
    const available = await getGatewayAvailableAtomic(this.policy.signer, ARC_MAINNET_PROFILE); this.assertLocal();
    if (available === null || BigInt(before.retainedMicroUsdc) + BigInt(micros) > BigInt(this.policy.lifetimeCapMicroUsdc) ||
      BigInt(before.retainedMicroUsdc) - BigInt(before.confirmedMicroUsdc) + BigInt(micros) > available)
      throw new Error("Hosted mainnet signer requires reviewed prefunding");
    const after = await this.db.hostedTreasuryAccounting(this.policy.signer, this.role); this.assertLocal();
    if (canonicalJson(before) !== canonicalJson(after)) throw new Error("Hosted accounting changed");
    this.budget = micros; return { address: this.policy.signer };
  }
}

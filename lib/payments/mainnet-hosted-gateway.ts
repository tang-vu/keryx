import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { applicationSqliteIdentity } from "../db/application-storage";
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
export function mainnetHostedPolicy(db: KeryxDB, role: "public" | "private" = "public") {
  if (config.profile !== ARC_MAINNET_PROFILE || process.env.KERYX_FORCE_OFFLINE === "1" || !["public","private"].includes(role)) throw new Error("Hosted mainnet authority unavailable");
  const identity = applicationSqliteIdentity(db, "write");
  let url: URL; try { url = new URL(config.baseUrl); } catch { throw new Error("Hosted origin unavailable"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Hosted origin unavailable");
  return configuredHostedTreasuryPolicy(identity, url.origin, role);
}
/** Public-address comparison and historical role proof; no signer construction,
 * signature, reservation, vendor request or funding. */
export async function assertMainnetHostedCustodyReady(db:KeryxDB,role:"public"|"private"="public") {
  const policy=mainnetHostedPolicy(db,role),keyName=role==="private"?"KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY":"KERYX_MAINNET_TREASURY_PRIVATE_KEY";
  try {
    const key=process.env[keyName];
    if(!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || privateKeyToAddress(key as `0x${string}`).toLowerCase()!==policy.signer) throw new Error();
  } catch { throw new Error("Dedicated hosted mainnet custody unavailable"); }
  await db.hostedTreasuryAccounting(policy.signer,role);
  if(canonicalJson(mainnetHostedPolicy(db,role))!==canonicalJson(policy)) throw new Error("Hosted policy changed");
  return policy;
}
/** Pre-purchase custody/capacity check. Never signs, reserves, funds or transacts. */
export async function assertMainnetHostedResearchReady(db:KeryxDB,budgetMicros:string,role:"public"|"private"="public") {
  if (configuredResearchAllowance()) throw new Error("Paid research admission is paused during bounded browser acceptance; original records remain recoverable");
  if(!/^[1-9][0-9]{0,15}$/.test(budgetMicros) || BigInt(budgetMicros)>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Hosted budget unavailable");
  const policy=await assertMainnetHostedCustodyReady(db,role),budget=BigInt(budgetMicros);
  if(budget>BigInt(policy.queryCapMicroUsdc)) throw new Error("Hosted operating configuration unavailable");
  const before=await db.hostedTreasuryAccounting(policy.signer,role);
  await assertArcRpcChain(config.rpcUrl,ARC_MAINNET_PROFILE);
  const available=await getGatewayAvailableAtomic(policy.signer,ARC_MAINNET_PROFILE);
  if(available===null || BigInt(before.retainedMicroUsdc)+budget>BigInt(policy.lifetimeCapMicroUsdc) ||
    BigInt(before.retainedMicroUsdc)-BigInt(before.confirmedMicroUsdc)+budget>available ||
    canonicalJson(before)!==canonicalJson(await db.hostedTreasuryAccounting(policy.signer,role))) throw new Error("Hosted current capacity unavailable");
  if(canonicalJson(await assertMainnetHostedCustodyReady(db,role))!==canonicalJson(policy)) throw new Error("Hosted policy changed");
}
/** Only an enrolled application DB and protected reviewed policy can reach the
 * dedicated key. Never loads legacy custody, creates a key, funds or transacts. */
export async function createMainnetHostedGateway(db: KeryxDB, options: {
  role?: "public" | "private"; job?: { id: string; owner: string; workerId: string };
} = {}) {
  const role = options.role ?? "public", policy = mainnetHostedPolicy(db, role);
  if ((role === "private") !== !!options.job) throw new Error("Hosted role requires its original execution job");
  if (role === "private" && policy.signer === mainnetHostedPolicy(db).signer) throw new Error("Private and public hosted custody must remain distinct");
  await db.admitHostedTreasuryPolicy(policy,role);
  // Read this separately named key only after the actual sealed policy admission.
  const keyName = role === "private" ? "KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY" : "KERYX_MAINNET_TREASURY_PRIVATE_KEY";
  const key = process.env[keyName];
  try {
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error();
    const account = privateKeyToAccount(key as `0x${string}`);
    if (account.address.toLowerCase() !== policy.signer || canonicalJson(mainnetHostedPolicy(db, role)) !== canonicalJson(policy)) throw new Error();
    return new MainnetHostedGateway(db, account, policy, role, options.job);
  } catch { throw new Error("Dedicated hosted mainnet custody unavailable"); }
}

class MainnetHostedGateway extends ServerPaymentGateway {
  protected spend: { address: string };
  protected batchScheme: BatchPayloadSigner = { createPaymentPayload: async () => { throw new Error("Hosted signing requires an original payment context"); } };
  private budget?: string;
  constructor(private readonly db: KeryxDB, private readonly account: PrivateKeyAccount,
    private readonly policy: HostedTreasuryPolicy, private readonly role: "public" | "private", private readonly job?: { id: string; owner: string; workerId: string }) {
    super(); this.spend = { address: policy.signer };
    this.paymentJournal = context => {
      if (context.kind === "operating-fee" && (role !== "public" || job)) throw new Error("Operating fees require public hosted authority");
      if (job && context.queryId !== job.id) throw new Error("Hosted private authority belongs to another job");
      const privateJournal = job && context.kind !== "operating-fee" ? privateCreatorJournal(db, { id: job.id, payer: job.owner, workerId: job.workerId,
        kind: context.kind, sourceId: context.sourceId, itemId: context.itemId }) : null;
      let nonce: string | undefined;
      return {
        beforeSubmit: async submission => { await privateJournal?.beforeSubmit(submission); },
        beforeSignedSubmit: async (submission, hash) => {
          this.assertPolicy(); nonce = submission.authorizationId;
          await db.submitHostedAuthorization(policy.signer, submission, hash);
        },
        recordOutcome: async value => {
          const extra = await privateJournal?.recordOutcome(value);
          let status: "pending" | "confirmed" | "confirmation-unpersisted" = "pending";
          if (nonce && value.authorizationId.toLowerCase() === nonce && value.settlementStatus === "settled" && value.transaction) {
            try { await db.confirmHostedAuthorization(policy.signer, nonce, value.transaction); status = "confirmed"; }
            catch { status = "confirmation-unpersisted"; }
          }
          return extra ?? { attempt: { ...value, authorizationPhase: value.settlementStatus === "settled" ? "settled" : "submission_attempted" }, confirmation: null, journalStatus: status };
        },
      };
    };
  }
  private assertPolicy() {
    if (canonicalJson(mainnetHostedPolicy(this.db, this.role)) !== canonicalJson(this.policy)) throw new Error("Hosted policy changed");
  }
  operatingFeePolicy() {
    this.assertPolicy();
    if (this.role !== "public" || this.job) throw new Error("Operating fees require public hosted authority");
    return configuredOperatingFeePolicy(applicationSqliteIdentity(this.db, "write"), this.policy.origin, this.policy.signer);
  }
  async payOperatingFee(args: { queryId: string; operatingFee: OperatingFeeContext }) {
    const policy = this.operatingFeePolicy(), fee = operatingFeeContextSchema.parse(args.operatingFee);
    if (fee.policyDigest !== operatingFeePolicyDigest(policy)) throw new Error("Operating fee policy changed");
    const context: PaymentJournalContext = { queryId: args.queryId, kind: "operating-fee", sourceId: OPERATING_FEE_SOURCE_ID, itemId: null, operatingFee: fee };
    const journal = this.paymentJournal!(context), amount = Number(fee.amountMicroUsdc) / 1e6;
    const attempt = await payWithServerSigner<{ ok?: boolean }>({ url: `${config.baseUrl}${operatingFeeEndpointPath(args.queryId, fee)}`, method: "POST",
      expectedPayee: policy.beneficiary, expectedAmount: amount, payer: this.policy.signer,
      signer: this.signerForPayment(context), beforeSubmit: journal.beforeSubmit, beforeSignedSubmit: journal.beforeSignedSubmit });
    const outcome = await journal.recordOutcome(attempt);
    const observed = outcome.attempt ?? attempt;
    const payment = paymentFromAttempt(observed, { kind: "operating-fee", queryId: args.queryId,
      sourceId: OPERATING_FEE_SOURCE_ID, sourceName: "Keryx operating fee", payer: this.policy.signer, payee: policy.beneficiary,
      settledRationale: "Keryx operating fee for evidence-qualified unclaimed public citations." });
    checkJournalOutcome(outcome.journalStatus, payment, observed);
    throwIfDeliveryFailed(observed, payment, "Keryx operating service");
    return payment;
  }
  protected signerForPayment(context: PaymentJournalContext) {
    const captured = { ...context }; this.assertPolicy();
    if (!this.budget) throw new Error("Hosted query budget not admitted");
    const queryBudgetMicroUsdc = this.budget;
    return createPinnedArcBatchSigner(this.account, config.rpcUrl, ARC_MAINNET_PROFILE, config.maxTimeoutSeconds, async payload => {
      this.assertPolicy();
      const before = await this.db.hostedTreasuryAccounting(this.policy.signer,this.role);
      const available = await getGatewayAvailableAtomic(this.policy.signer, ARC_MAINNET_PROFILE);
      if (available === null) throw new Error("Hosted prefunded balance unavailable");
      this.assertPolicy();
      const admittedContext = captured.kind === "operating-fee"
        ? { ...captured, queryBudgetMicroUsdc, privateJob: null }
        : { ...captured, queryBudgetMicroUsdc, privateJob: this.job ?? null };
      await this.db.admitHostedAuthorization({ policy: this.policy, context: admittedContext,
        payload, accounting: before, availableMicroUsdc: String(available) });
    });
  }
  async ensureFunded(budget: number) {
    this.assertPolicy(); const micros = exactBudget(budget);
    if (this.budget && micros !== this.budget || BigInt(micros) > BigInt(this.policy.queryCapMicroUsdc)) throw new Error("Hosted query budget refused");
    const before = await this.db.hostedTreasuryAccounting(this.policy.signer), available = await getGatewayAvailableAtomic(this.policy.signer, ARC_MAINNET_PROFILE);
    if (available === null || BigInt(before.retainedMicroUsdc) + BigInt(micros) > BigInt(this.policy.lifetimeCapMicroUsdc) ||
      BigInt(before.retainedMicroUsdc) - BigInt(before.confirmedMicroUsdc) + BigInt(micros) > available)
      throw new Error("Hosted mainnet signer requires reviewed prefunding");
    if (canonicalJson(before) !== canonicalJson(await this.db.hostedTreasuryAccounting(this.policy.signer))) throw new Error("Hosted accounting changed");
    this.assertPolicy(); this.budget = micros; return { address: this.policy.signer };
  }
}

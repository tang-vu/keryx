import type { KeryxDB } from "../db/keryx-db";
import type { ReasoningEngine } from "../llm";
import type { BatchPayloadSigner } from "../payments/server-x402-client";
import { PrivateServerGateway } from "../payments/private-server-gateway";
import { privateResearchEffects } from "../agent/private-research-effects";
import { collectRun } from "../agent";
import { a2aResearchPackageForVersion } from "./research-package-definition";
import { addressSchema } from "../buyer/protocol";
import { privateReasoningPolicyInput } from "../buyer/private-reasoning-policy";
import { privateReasoningEngine, type PrivateReasoningConfig } from "../llm/private-engine";

/** Backend executor. Caller authenticates payer; this module never accepts an unsigned question or job policy. */
export async function runPrivateResearch(db: KeryxDB, id: string, payer: string, options: {
  signerAddress: string; signer: BatchPayloadSigner; getGatewayBalance: () => Promise<bigint>;
  /** Legacy v1 execution only; ignored for provider-bound v2 requests. */
  engineForModel?: (model: string | null) => ReasoningEngine;
  privateProvider?: PrivateReasoningConfig;
}) {
  const { signer, getGatewayBalance, engineForModel } = options;
  const requestedSignerAddress = options.signerAddress;
  // Snapshot credentials and routing before storage awaits; never accept a caller-supplied
  // disclosure as evidence of which transport will actually run.
  const privateProvider = options.privateProvider === undefined ? undefined : { ...options.privateProvider };
  const intent = await db.getPrivateResearchIntent(id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const request = intent.submission.request;
  const committedPolicy = "reasoning" in request ? privateReasoningPolicyInput(request.reasoning) : null;
  const contract = a2aResearchPackageForVersion(request.researchMode, request.packageVersion);
  if (!contract) throw new Error("Private research package unavailable");
  const signerAddress = addressSchema.parse(requestedSignerAddress);
  if ((await db.getPrivatePaymentState(id, payer))?.status !== "settled") throw new Error("Settled private payment unavailable");
  const previous = await db.getPrivateResearchResult(id, payer);
  if (previous) return { status: "stored" as const, result: previous };
  if (await db.getPrivateResearchExecution(id, payer)) return { status: "already-claimed" as const };
  const built = privateProvider === undefined ? null : privateReasoningEngine(privateProvider);
  if (committedPolicy !== (built ? privateReasoningPolicyInput(built.disclosure) : null)) throw new Error("Private reasoning policy does not match the signed request");
  if (!built && !engineForModel) throw new Error("Private reasoning engine unavailable");
  if (committedPolicy) {
    const reservation = await db.getPrivateTreasury(id, payer);
    if (!reservation || reservation.signer !== signerAddress.toLowerCase()) throw new Error("Private treasury allocation unavailable for this signer");
  }
  const balance = await getGatewayBalance();
  if (typeof balance !== "bigint" || balance < BigInt(Math.round(request.budget * 1e6))) throw new Error("Private creator payer requires prefunding");
  const engine = built?.engine ?? engineForModel!(request.model);
  const claim = await db.claimPrivateResearchExecution(id, payer);
  if (!claim) return { status: "already-claimed" as const };
  const gateway = new PrivateServerGateway({ signerAddress, signer, getGatewayBalance,
    db, job: { id, owner: payer, workerId: claim.workerId } });
  const { effects, diagnostics } = await privateResearchEffects(db, { id, payer, workerId: claim.workerId });
  const run = await collectRun({ queryId: id, question: request.question, budget: request.budget, researchMode: request.researchMode,
    model: request.model ?? undefined, executionLimits: { ...contract.execution }, asker: intent.submission.payment.authorization.from,
    origin: "a2a", fundingOwner: "treasury" }, { deps: { db, engine, gateway, effects } });
  return { status: "completed" as const, run, diagnostics };
}

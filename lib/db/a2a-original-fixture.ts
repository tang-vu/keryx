/** Synthetic database fixtures only; no signature, funding or vendor settlement. */
import { ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { a2aOrderId, a2aRequestHash, type A2aOrder } from "../a2a/order";
import { a2aResearchPackage, a2aResearchPackageFingerprint } from "../a2a/research-package";
import type { A2aOriginalClaim } from "../a2a/original-claim";
import type { PaymentRecord } from "../types";
import type { KeryxDB } from "./keryx-db";

export function syntheticA2aOriginal(index = 1, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  const authorizationId = `0x${index.toString(16).padStart(64, "0")}`;
  const payer = `0x${"11".repeat(20)}`, payee = `0x${"22".repeat(20)}`;
  const id = a2aOrderId({ network: profile.networkId, payer, payee, authorizationId });
  const request = { question: `Synthetic original ${index}: tài liệu 🔒\n\"quote\" / 'apostrophe'`, origin: "a2a" as const,
    network: profile.networkId, model: "deepseek-v4-flash" };
  const pkg = a2aResearchPackage("quick");
  const order: A2aOrder = { id, queryId: id, authorizationId, requestHash: a2aRequestHash({ ...request,
    creatorBudgetUsdc: 0.01, serviceFeeUsdc: 0.02, researchMode: "quick", researchPackage: pkg }),
    payer, payee, amountUsdc: 0.03, creatorBudgetUsdc: 0.01, serviceFeeUsdc: 0.02,
    researchMode: "quick", researchPackage: pkg, status: "running", transaction: `synthetic-no-settlement-${index}`,
    request, startedAt: null, workerId: null, executionJournalVersion: 1, paymentStartedAt: null, resultSavingAt: null,
    response: null, errorCode: null, resolution: null, createdAt: "2026-10-06T03:23:02.000Z", updatedAt: "2026-10-06T03:23:02.000Z" };
  const binding: A2aOriginalClaim = { id, queryId: id, requestHash: order.requestHash, payer, payee, authorizationId,
    amountMicroUsdc: "30000", creatorBudgetMicroUsdc: "10000", serviceFeeMicroUsdc: "20000",
    packageFingerprint: a2aResearchPackageFingerprint(pkg), network: profile.networkId,
    asset: profile.usdcAddress.toLowerCase(), gatewayContract: profile.gatewayWallet.toLowerCase() };
  const inbound: PaymentRecord = { id: `inbound_${id}`, kind: "inbound", queryId: id, sourceId: "a2a", sourceName: "Synthetic caller",
    payer, payee, amountUsdc: order.amountUsdc, txHash: order.transaction, authorizationId, network: profile.networkId,
    settled: true, settlementStatus: "settled", origin: "a2a", createdAt: order.createdAt };
  return { order, binding, inbound };
}

export async function seedSyntheticA2aOriginal(db: Pick<KeryxDB, "claimResearchPurchase" | "createA2aOrder" | "recordPaymentOnce">,
  fixture = syntheticA2aOriginal()) {
  const { order, binding, inbound } = fixture;
  await db.claimResearchPurchase({ network: binding.network, asset: binding.asset, payer: binding.payer, payee: binding.payee,
    authorizationId: binding.authorizationId, purpose: "a2a", requestHash: binding.requestHash, amountMicros: Number(binding.amountMicroUsdc) });
  await db.recordPaymentOnce(inbound);
  await db.createA2aOrder(order);
  return fixture;
}

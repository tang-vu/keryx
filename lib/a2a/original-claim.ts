import { z } from "zod";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { exactA2aMicros } from "./amount-micros";
import { a2aOrderId, a2aRequestHash, type A2aOrder } from "./order";
import { a2aResearchPackageFingerprint, isSupportedA2aResearchPackage } from "./research-package";

const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const micros = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));

/** Trusted original binding, never inferred from whichever queued row wins a claim. */
export const a2aOriginalClaimSchema = z.object({
  id: z.string().regex(/^a2a_[0-9a-f]{64}$/),
  queryId: z.string().regex(/^a2a_[0-9a-f]{64}$/),
  requestHash: hash, payer: address, payee: address,
  authorizationId: z.string().regex(/^0x[0-9a-f]{64}$/),
  amountMicroUsdc: micros, creatorBudgetMicroUsdc: micros, serviceFeeMicroUsdc: micros,
  packageFingerprint: hash,
  network: z.enum(["eip155:5042", "eip155:5042002"]),
  asset: address, gatewayContract: address,
}).strict().refine(value => {
  const profile = value.network === ARC_MAINNET_PROFILE.networkId ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE;
  return value.id === value.queryId && value.id === a2aOrderId(value) &&
    BigInt(value.amountMicroUsdc) === BigInt(value.creatorBudgetMicroUsdc) + BigInt(value.serviceFeeMicroUsdc) &&
    value.asset === profile.usdcAddress.toLowerCase() && value.gatewayContract === profile.gatewayWallet.toLowerCase();
}, "Original claim identity, economics or rail mismatch");

export type A2aOriginalClaim = z.infer<typeof a2aOriginalClaimSchema>;

export function validateA2aOriginalClaim(value: unknown, profile: ArcNetworkProfile): A2aOriginalClaim {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Original claim profile unavailable");
  const binding = a2aOriginalClaimSchema.parse(value);
  if (binding.network !== profile.networkId) throw new Error("Original claim profile mismatch");
  return binding;
}

export function validateA2aClaimWorker(workerId: string, startedAt: string): void {
  if (typeof workerId !== "string" || !workerId.trim() || workerId.length > 200 ||
    typeof startedAt !== "string" || !z.string().datetime().safeParse(startedAt).success ||
    new Date(startedAt).toISOString() !== startedAt) throw new Error("Original claim worker unavailable");
}

/** Queue-neutral immutable tuple/body check; it does not establish settlement or authorize execution. */
export function matchesA2aOriginalBinding(order: A2aOrder, binding: A2aOriginalClaim): boolean {
  const request = order.request;
  if (order.id !== binding.id || order.queryId !== binding.queryId || order.requestHash !== binding.requestHash ||
    order.payer.toLowerCase() !== binding.payer || order.payee.toLowerCase() !== binding.payee ||
    order.authorizationId.toLowerCase() !== binding.authorizationId ||
    !order.transaction.trim() || order.transaction.length > 512 || !request ||
    Object.prototype.hasOwnProperty.call(request, "monthlyId") || request.network !== binding.network ||
    (request.origin !== "a2a" && request.origin !== "engine") || typeof request.question !== "string" ||
    !request.question.trim() || request.question.length > 10_000 ||
    (request.model !== undefined && (typeof request.model !== "string" || !request.model.trim() || request.model.length > 256)) ||
    exactA2aMicros(order.amountUsdc) !== Number(binding.amountMicroUsdc) ||
    exactA2aMicros(order.creatorBudgetUsdc) !== Number(binding.creatorBudgetMicroUsdc) ||
    exactA2aMicros(order.serviceFeeUsdc) !== Number(binding.serviceFeeMicroUsdc) ||
    !isSupportedA2aResearchPackage(order.researchPackage, order.researchMode) ||
    a2aResearchPackageFingerprint(order.researchPackage) !== binding.packageFingerprint) return false;
  return a2aRequestHash({ ...order, question: request.question, model: request.model }) === binding.requestHash;
}

/** Called before UPDATE while the native writer holds the original row/transaction. */
export function matchesA2aOriginalClaim(order: A2aOrder, binding: A2aOriginalClaim): boolean {
  return matchesA2aOriginalBinding(order, binding) && order.status === "running" && order.startedAt === null &&
    order.workerId === null && order.executionJournalVersion === 1 && order.paymentStartedAt === null &&
    order.resultSavingAt === null && order.response === null && order.errorCode === null && order.resolution === null;
}

import { recoverMessageAddress, recoverTypedDataAddress, type Hex } from "viem";
import { createHash } from "node:crypto";
import type { KeryxDB } from "../db/keryx-db";
import { monthlyOrderId, type MonthlyPurchase } from "../db/research-monthly";
import { a2aRequestHash, type A2aOrder } from "../a2a/order";
import { monthlyMessage, monthlyProofSchema } from "./protocol";
import { authorizationSchema, buyerTypedData, decodeHeader } from "../buyer/protocol";

export function monthlyQuestionDigest(question: string) { return createHash("sha256").update(question).digest("hex"); }

export async function verifyMonthlyProof(action: "status" | "redeem", payload: unknown, value: unknown, now = Date.now()) {
  const proof = monthlyProofSchema.parse(value);
  if (proof.timestamp > now + 30_000 || now - proof.timestamp > 300_000) throw new Error("Wallet proof expired");
  const signer = await recoverMessageAddress({ message: monthlyMessage(action, payload, proof.timestamp), signature: proof.signature as Hex });
  if (signer.toLowerCase() !== proof.payer.toLowerCase()) throw new Error("Wallet proof mismatch");
  return proof.payer;
}

/** Verify the actual debit envelope before Circle: SDK resource metadata is unsigned. */
export async function monthlyPaymentAuthorization(header: string | null, payee: string, amount: number) {
  const raw = decodeHeader(header) as { payload?: unknown };
  const payment = (raw?.payload ?? raw) as { authorization?: unknown; signature?: unknown };
  const authorization = authorizationSchema.parse(payment.authorization);
  if (authorization.to.toLowerCase() !== payee.toLowerCase() || authorization.value !== String(amount)
    || typeof payment.signature !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(payment.signature)) throw new Error("Wrong Monthly payment");
  const payer = await recoverTypedDataAddress({ ...buyerTypedData(authorization), signature: payment.signature as Hex });
  if (payer.toLowerCase() !== authorization.from.toLowerCase()) throw new Error("Wrong Monthly signer");
  return authorization;
}

export async function redeemMonthly(db: KeryxDB, purchase: MonthlyPurchase, input: { requestId: string; question: string; payer: string }, now = new Date().toISOString()) {
  const orderId = monthlyOrderId(purchase.id, input.requestId);
  const creatorBudgetUsdc = purchase.creatorBudgetMicros / 1e6;
  const serviceFeeUsdc = purchase.serviceFeeMicros / 4 / 1e6;
  const requestHash = a2aRequestHash({ question: input.question, creatorBudgetUsdc, serviceFeeUsdc,
    researchMode: "deep", researchPackage: purchase.researchPackage });
  const order: A2aOrder = { id: orderId, queryId: orderId, authorizationId: `${purchase.authorizationId}:monthly:${input.requestId}`,
    requestHash, payer: input.payer, payee: purchase.payee, amountUsdc: purchase.totalMicros / 4 / 1e6,
    creatorBudgetUsdc, serviceFeeUsdc, researchMode: "deep", researchPackage: purchase.researchPackage,
    status: "running", transaction: purchase.transaction, request: { question: input.question, origin: "a2a", monthlyId: purchase.id },
    startedAt: null, workerId: null, executionJournalVersion: 1, paymentStartedAt: null, resultSavingAt: null,
    response: null, errorCode: null, resolution: null, createdAt: now, updatedAt: now };
  return db.redeemResearchMonthly({ monthlyId: purchase.id, payer: input.payer, requestId: input.requestId, now, order });
}

import type { QueryRun, PaymentRecord } from "../types";
import { captureLedgerRun } from "./capture";
import { projectOperatorLedger } from "./projection";

export const LEDGER_FIXTURE_TIME = "2026-10-09T09:00:00.000Z";
const wallet = `0x${"a".repeat(40)}`;
export function ledgerRun(overrides: Partial<QueryRun> = {}): QueryRun {
  return { id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-10-09T08:00:00.000Z",
    question: "PRIVATE-CUSTOMER-QUESTION-NOT-EXPORTED", answer: "PRIVATE-ANSWER-NOT-EXPORTED", budget: 0.1, engine: "fixture",
    subClaims: [], decisions: [{ sourceId: "creator-one", sourceName: "Not projected", action: "BUY", expectedValue: 1,
      price: 0.0157, confidence: 1, rationale: "PRIVATE-RATIONALE-NOT-EXPORTED", targets: [] }], citations: [],
    totalSpent: 0.0157, totalToCreators: 0, trace: [], origin: "web", provenance: { version: 1, surface: "web", ownershipMethod: "unknown" },
    fundingOwner: "treasury", paymentMode: "real", settledPayments: 1, pendingPayments: 0, ...overrides };
}
export function ledgerPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { id: "payment-one", queryId: ledgerRun().id, sourceId: "creator-one", sourceName: "Not projected", kind: "fetch",
    network: "eip155:5042002", amountUsdc: 0.0157, payer: wallet, payee: `0x${"b".repeat(40)}`,
    createdAt: "2026-10-09T08:01:00.000Z", settled: true, settlementStatus: "settled", origin: "web",
    txHash: "22222222-2222-4222-8222-222222222222", authorizationId: "auth-one", ...overrides };
}
export function ledgerFixture(runs = [ledgerRun()], payments = [ledgerPayment()]) {
  return projectOperatorLedger({ network: "eip155:5042002", days: 7, readStartedAt: LEDGER_FIXTURE_TIME, readCompletedAt: LEDGER_FIXTURE_TIME,
    runs: runs.map(run => captureLedgerRun(run)!).filter(Boolean), payments: payments.map(payment => ({ ...payment })),
    runLimitReached: false, paymentLimitReached: false });
}

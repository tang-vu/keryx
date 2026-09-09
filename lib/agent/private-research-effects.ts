import type { KeryxDB } from "../db/keryx-db";
import type { ResearchEffects } from "./research-effects";
import { assertPaymentSettlementState } from "../payments/payment-state";

/** Backend dependency only. The executor, not this consistency check, must obtain a fresh worker claim. */
export async function privateResearchEffects(db: KeryxDB, context: { id: string; payer: string; workerId: string }) {
  const { id, payer, workerId } = { ...context };
  const claim = await db.getPrivateResearchExecution(id, payer);
  if (!claim || claim.id !== id || claim.workerId !== workerId) throw new Error("Private execution authority unavailable");
  const cache = new Map<string, { text: string; at: string }>();
  // Counts only. Never retain or forward private alert/notification payloads.
  const diagnostics = { alerts: 0, suppressedCitationNotifications: 0 };
  const effects: ResearchEffects = {
    scope: { kind: "job", queryId: id },
    async recordPayment(payment) {
      const status = assertPaymentSettlementState(payment);
      if (payment.queryId !== id || !payment.authorizationId || !["fetch", "citation"].includes(payment.kind)
        || (status !== "settled" && status !== "pending")) throw new Error("Private payment record mismatch");
      const attempt = (await db.listPrivateCreatorSubmissions(id, payer)).find(row => row.data.submission.authorizationId === payment.authorizationId!.toLowerCase());
      if (!attempt || attempt.workerId !== workerId) throw new Error("Private payment admission unavailable");
      const { submission } = attempt.data;
      if (attempt.data.kind !== payment.kind || attempt.data.sourceId !== payment.sourceId || attempt.data.itemId !== (payment.itemId ?? null)
        || submission.payer !== payment.payer.toLowerCase() || submission.payee !== payment.payee.toLowerCase()
        || submission.network !== payment.network || Number(submission.amountMicros) / 1e6 !== payment.amountUsdc
        || submission.authorizationExpiresAt !== payment.authorizationExpiresAt) throw new Error("Private payment record mismatch");
      if (status === "settled") {
        const confirmed = await db.getPrivateCreatorConfirmation(id, payer, submission.authorizationId);
        if (!confirmed || confirmed.confirmation.transaction !== payment.txHash) throw new Error("Private settlement confirmation requires recovery");
      }
      // Gateway admission/outcome own persistence. Never copy this record into public payment_events.
    },
    getCached: async key => cache.get(key)?.text ?? null,
    getCachedAt: async key => cache.get(key)?.at ?? null,
    setCached: async (key, text) => { cache.set(key, { text, at: new Date().toISOString() }); },
    async saveQueryRun(run) {
      await db.savePrivateResearchResult(id, payer, workerId, run);
      cache.clear();
    },
    discoverExternal: async () => [],
    decisionContext: async () => ({ sample: 0 }),
    saveMemory: async () => {},
    notifyCitation: () => { diagnostics.suppressedCitationNotifications++; },
    alert: () => { diagnostics.alerts++; },
    activation: async () => {},
  };
  return { effects, diagnostics };
}

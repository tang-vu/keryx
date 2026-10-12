import type { PaidJobAlert, PaidJobAlertChannel } from "../a2a/paid-job-alert-observer";
import { operationalAlertChannelsReady, sendAlert } from "./alert";

/** Only the existing explicitly configured ops channels. No public bot/customer fallback. */
export function paidJobAlertChannel(): PaidJobAlertChannel {
  return { ready: operationalAlertChannelsReady, send: async ({ incidentId, original }: PaidJobAlert) =>
    sendAlert("Paid job completion target exceeded", [
      `Incident: ${incidentId}`, `Original order: ${original.orderId}`,
      `Original payment/allocation reference: ${original.payment.reference}`,
      `Network: ${original.payment.network}; amount: ${original.payment.amountMicros} micro-USDC`,
      `Accepted: ${original.escalation.acceptedAt}; target: ${original.escalation.targetCompletionAt}`,
      `Observed: ${original.escalation.observedAt}; state: ${original.operationalState}`,
      `Last recorded stage: ${original.escalation.lastRecordedStage}; failure: ${original.escalation.failureCode ?? "none recorded"}`,
      `Creator payment evidence: ${original.escalation.creatorPaymentState}`,
      "Human review required. Preserve the original payment and uncertain legs; do not sign, buy, retry or refund automatically.",
    ].join("\n"), { logDetail: false }) };
}

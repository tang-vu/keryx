/** Creator earnings exclude inbound service charges and Keryx operating fees. */
export function isCreatorPayment(payment: { kind: string }): boolean {
  return payment.kind === "fetch" || payment.kind === "citation";
}

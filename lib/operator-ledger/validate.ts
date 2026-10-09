import { operatorLedgerSchema, type LedgerEntry, type OperatorLedger } from "./contracts";

/** Checksum plus voucher/leg/trial-balance consistency. This grants no authenticity or settlement authority. */
export function validateLedgerBindings(value: unknown): OperatorLedger {
  const ledger = operatorLedgerSchema.parse(value);
  const seen = new Set<string>(), vouchers = new Map<string, LedgerEntry[]>();
  let debit = BigInt(0), credit = BigInt(0);
  for (const entry of ledger.payload.entries) {
    const key = `${entry.jobId}:${entry.voucherId}`;
    const rows = vouchers.get(key) ?? []; rows.push(entry); vouchers.set(key, rows);
    debit += BigInt(entry.debitMicroUsdc); credit += BigInt(entry.creditMicroUsdc);
  }
  const zero = () => ({ accessMicroUsdc: BigInt(0), rewardMicroUsdc: BigInt(0), sponsoredFeeMicroUsdc: BigInt(0) });
  const totals = { browser: zero(), treasury: zero(), unknown: zero(), offline: zero() };
  for (const job of ledger.payload.jobs) {
    if (seen.has(job.id) || job.evidencePath !== `/api/dispatch/${job.id}/receipt` || job.decisionPath !== `/dispatch/${job.id}`)
      throw new Error("Ledger job binding mismatch");
    seen.add(job.id);
    const sums = zero(), legs = new Set<string>();
    for (const leg of job.legs) {
      if (legs.has(leg.id)) throw new Error("Ledger original identity repeated");
      legs.add(leg.id);
      if (leg.state !== "settled") {
        if (leg.settlementReference !== null) throw new Error("Unsettled ledger evidence mismatch");
        continue;
      }
      if (job.funding === "offline" || !leg.kind || !leg.sourceId || !leg.createdAt || !leg.amountMicroUsdc || BigInt(leg.amountMicroUsdc) <= BigInt(0) ||
        leg.reason !== null || !leg.settlementReference || !/^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|0x[0-9a-fA-F]{64})$/.test(leg.settlementReference))
        throw new Error("Settled ledger evidence mismatch");
      const key = `${job.id}:${leg.id}`, rows = vouchers.get(key);
      const account = leg.kind === "fetch" ? "recipient:access" : leg.kind === "citation" ? "recipient:reward" : "recipient:sponsored-fee";
      if (!rows || rows.length !== 2 || !rows.every(row => row.funding === job.funding && row.evidencePath === job.evidencePath && row.settlementReference === leg.settlementReference) ||
        !rows.some(row => row.account === account && row.debitMicroUsdc === leg.amountMicroUsdc && row.creditMicroUsdc === "0") ||
        !rows.some(row => row.account === `sender:${job.funding}` && row.debitMicroUsdc === "0" && row.creditMicroUsdc === leg.amountMicroUsdc))
        throw new Error("Ledger voucher binding mismatch");
      vouchers.delete(key);
      const category = leg.kind === "fetch" ? "accessMicroUsdc" : leg.kind === "citation" ? "rewardMicroUsdc" : "sponsoredFeeMicroUsdc";
      sums[category] += BigInt(leg.amountMicroUsdc); totals[job.funding][category] += BigInt(leg.amountMicroUsdc);
    }
    for (const key of Object.keys(sums) as Array<keyof typeof sums>) if (sums[key].toString() !== job.settled[key]) throw new Error("Ledger job total mismatch");
    if (job.uncertainLegs !== job.legs.filter(leg => leg.state === "uncertain").length || job.pendingLegs !== job.legs.filter(leg => leg.state === "pending").length ||
      (job.uncertainLegs > 0 || job.pendingLegs > 0) && job.legCoverage !== "incomplete") throw new Error("Ledger uncertainty mismatch");
  }
  for (const funding of ["browser", "treasury", "unknown", "offline"] as const) {
    for (const key of Object.keys(totals[funding]) as Array<keyof ReturnType<typeof zero>>) {
      if (totals[funding][key].toString() !== ledger.payload.settledByFunding[funding][key]) throw new Error("Ledger funding total mismatch");
    }
  }
  if (vouchers.size || debit !== credit || debit.toString() !== ledger.payload.trialBalance.debitMicroUsdc || credit.toString() !== ledger.payload.trialBalance.creditMicroUsdc)
    throw new Error("Ledger trial balance mismatch");
  return ledger;
}


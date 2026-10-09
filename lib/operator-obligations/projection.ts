import { canonicalJson } from "../canonical-json";
import { assertBoundedObligationData, MAX_OBSERVATION_AGE_MS, obligationProjectionSchema,
  obligationSnapshotSchema, REQUIRED_OBLIGATION_DOMAINS, type ObligationReason } from "./contracts";

const ZERO = BigInt(0), SCALE = BigInt("1000000000000");
const nonnegative = (value: bigint) => value < ZERO ? ZERO : value;
const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);

/** Pure, nonauthorizing projection. Even complete fixture evidence is an estimate,
 * never a native snapshot, cash reservation, release, refund or permission to spend. */
export function projectOperatorObligations(raw: unknown, nowMs: number) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 8_640_000_000_000_000) throw new Error("Invalid observation time");
  assertBoundedObligationData(raw);
  const s = obligationSnapshotSchema.parse(raw), reasons = new Set<ObligationReason>();
  const scope = canonicalJson(s.scope);
  const fresh = (time: string) => { const age = nowMs - Date.parse(time); if (age < 0 || age > MAX_OBSERVATION_AGE_MS) reasons.add("stale-observation"); };
  const bound = (row: { scope: typeof s.scope; snapshotId: string; observedAt: string }) => {
    if (canonicalJson(row.scope) !== scope || row.snapshotId !== s.snapshotId) reasons.add("foreign-binding");
    fresh(row.observedAt);
  };
  fresh(s.observedAt);
  if (s.consistency !== "atomic") reasons.add("partial-snapshot");
  // No complete native port exists in this source slice. Caller JSON cannot assert one.
  if (s.source === "native-journal") reasons.add("native-complete-unavailable");
  const domains = new Set<string>();
  for (const d of s.domains) {
    fresh(d.observedAt);
    if (domains.has(d.domain)) reasons.add("conflicting-original");
    domains.add(d.domain);
    if (d.coverage !== "complete") reasons.add("partial-domain");
  }
  if (REQUIRED_OBLIGATION_DOMAINS.some(d => !domains.has(d))) reasons.add("missing-domain");
  if (s.overlap !== "resolved") reasons.add("overlap-unresolved");

  let liquid = ZERO, excluded = ZERO, liquidKnown = true;
  const balances = new Map<string, typeof s.cash>();
  const cashIds = new Set<string>(), cashOriginals = new Set<string>();
  for (const c of s.cash) {
    bound(c);
    if (!c.verifiedOriginal) { reasons.add("unverified-original"); liquidKnown = false; }
    if (cashIds.has(c.id)) { reasons.add("conflicting-original"); liquidKnown = false; }
    cashIds.add(c.id);
    cashOriginals.add(c.originalId);
    const micros = c.units === "native-18" ? BigInt(c.amount) / SCALE : BigInt(c.amount);
    if (["incoming-pending", "bridge-in-transit", "vault-quote", "disputed"].includes(c.kind)) { excluded += micros; continue; }
    const expected = s.scope.compartment === "wallet" ? ["wallet-native", "wallet-erc20"] : ["gateway-available"];
    if (!expected.includes(c.kind) || c.kind === "wallet-native" && c.units !== "native-18" || c.kind !== "wallet-native" && c.units !== "micro-usdc") {
      reasons.add("wrong-units"); liquidKnown = false;
    }
    if (!c.finalized) { reasons.add("cash-unverified"); liquidKnown = false; }
    balances.set(c.balanceId, [...(balances.get(c.balanceId) ?? []), c]);
  }
  // One independently spendable compartment has one balance. Alias evidence is explicit.
  if (balances.size !== 1) { reasons.add("cash-unverified"); liquidKnown = false; }
  for (const records of balances.values()) {
    const first = records[0], amount = first.units === "native-18" ? BigInt(first.amount) / SCALE : BigInt(first.amount);
    const kinds = new Set(records.map(c => c.kind));
    if (records.length > 2 || kinds.size !== records.length || records.length === 2 &&
      !(kinds.has("wallet-native") && kinds.has("wallet-erc20"))) { reasons.add("cash-alias-mismatch"); liquidKnown = false; }
    for (const c of records) {
      const n = c.units === "native-18" ? BigInt(c.amount) / SCALE : BigInt(c.amount);
      if (n !== amount || c.originalId !== first.originalId || c.observedAt !== first.observedAt || c.evidenceId !== first.evidenceId) {
        reasons.add("cash-alias-mismatch"); liquidKnown = false;
      }
    }
    liquid += amount; // Arc native and ERC-20 aliases contribute once, including native dust floor.
  }

  const liabilities = new Map<string, (typeof s.liabilities)[number]>(), originals = new Map<string, string>();
  for (const row of s.liabilities) {
    bound(row);
    if (!row.verifiedOriginal) reasons.add("unverified-original");
    if (row.outcome === "confirmed-debit" && (!row.verifiedOriginal || !row.confirmationId ||
      !["payment-exposure", "creator-debt", "refund-withdrawal", "gas-fee"].includes(row.category))) reasons.add("unverified-outcome");
    if (cashIds.has(row.id) || cashOriginals.has(row.originalId)) reasons.add("conflicting-original");
    const prior = liabilities.get(row.id);
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(row)) {
        reasons.add("conflicting-original");
        liabilities.set(`${row.id}:conflict:${liabilities.size}`, row); // Retain both possible amounts; never select the smaller by input order.
      }
      continue;
    }
    if (originals.has(row.originalId)) reasons.add("conflicting-original");
    originals.set(row.originalId, row.id); liabilities.set(row.id, row);
    if (row.units === "native-18" && (row.category !== "gas-fee" || s.scope.compartment !== "wallet")) reasons.add("wrong-units");
  }
  const included = new Map<string, string>(), childTotals = new Map<string, bigint>();
  const amount = (r: (typeof s.liabilities)[number]) => r.units === "native-18"
    ? (BigInt(r.amount) + SCALE - BigInt(1)) / SCALE : BigInt(r.amount);
  for (const link of s.inclusions) {
    const child = liabilities.get(link.childId), parent = liabilities.get(link.parentId);
    if (link.snapshotId !== s.snapshotId || !child || !parent || included.has(link.childId) || link.childId === link.parentId ||
      parent.category !== "prepaid-job-cap" || !parent.verifiedOriginal || !child.verifiedOriginal ||
      parent.outcome === "confirmed-debit" || child.outcome === "confirmed-debit" ||
      child.units !== "micro-usdc" || parent.units !== "micro-usdc" ||
      (link.kind === "monthly-slot-redeemed-to-job" ? child.category !== "monthly-slot-cap" : !["payment-exposure", "creator-debt"].includes(child.category))) {
      reasons.add("ambiguous-inclusion"); continue;
    }
    included.set(child.id, parent.id);
    childTotals.set(parent.id, (childTotals.get(parent.id) ?? ZERO) + amount(child));
  }
  for (const [parent, total] of childTotals) if (total > amount(liabilities.get(parent)!)) reasons.add("ambiguous-inclusion");
  // Category constraints prevent nested/cyclic parents; unresolved relations retain every full amount.
  if (["ambiguous-inclusion", "foreign-binding", "conflicting-original", "stale-observation", "unverified-original", "wrong-units"]
    .some(reason => reasons.has(reason as ObligationReason))) included.clear();
  let protectedAmount = ZERO, dueNow = ZERO, dueHorizon = ZERO;
  const p = s.policy;
  if (!p) reasons.add("missing-policy");
  else {
    bound(p);
    if (!p.reviewed) reasons.add("policy-unreviewed");
    if (p.reserveFloorMicroUsdc === null || p.operatingBudgetMicroUsdc === null) reasons.add("missing-policy");
    if (Date.parse(p.expiresAt) <= nowMs) reasons.add("policy-expired");
    if (p.horizonAt === null || Date.parse(p.horizonAt) < nowMs || Date.parse(p.horizonAt) - nowMs > 90 * 24 * 60 * 60_000) reasons.add("invalid-horizon");
  }
  for (const row of liabilities.values()) {
    const confirmed = !reasons.has("conflicting-original") && !reasons.has("foreign-binding") && !reasons.has("stale-observation") && !reasons.has("wrong-units") && row.outcome === "confirmed-debit" && row.verifiedOriginal && row.confirmationId &&
      ["payment-exposure", "creator-debt", "refund-withdrawal", "gas-fee"].includes(row.category);
    if (confirmed || included.has(row.id)) continue;
    const n = amount(row); protectedAmount += n;
    // Inclusion removes duplicate money, never an earlier or unknown deadline.
    const dueTimes = [row.dueAt, ...[...included].filter(([, parent]) => parent === row.id).map(([child]) => liabilities.get(child)!.dueAt)];
    const earliest = dueTimes.some(t => t === null) ? null : Math.min(...dueTimes.map(t => Date.parse(t!)));
    if (earliest === null || earliest <= nowMs) dueNow += n;
    if (p?.horizonAt && (earliest === null || earliest <= Date.parse(p.horizonAt))) dueHorizon += n;
  }
  const reserve = p?.reserveFloorMicroUsdc !== null && p ? BigInt(p.reserveFloorMicroUsdc) : null;
  const operating = p?.operatingBudgetMicroUsdc !== null && p ? BigInt(p.operatingBudgetMicroUsdc) : null;
  const capacity = p ? BigInt(p.remainingOriginalCapacityMicroUsdc) : null;
  const shortfall = liquidKnown && reserve !== null ? nonnegative(protectedAmount + reserve - liquid) : null;
  if (shortfall !== null && shortfall > ZERO) reasons.add("coverage-short");
  const known = reasons.size === 0;
  return obligationProjectionSchema.parse({ version: 1, scope: s.scope, snapshotId: s.snapshotId, observedAt: s.observedAt,
    source: s.source, status: known ? "estimated" : "unknown", advisoryOnly: true, spendAuthority: false, nativeComplete: false,
    reasons: [...reasons].sort(), liquidMicroUsdc: liquidKnown ? String(liquid) : null,
    protectedMicroUsdc: String(protectedAmount), dueNowMicroUsdc: String(dueNow), dueWithinHorizonMicroUsdc: p?.horizonAt ? String(dueHorizon) : null,
    excludedNonLiquidMicroUsdc: String(excluded), reserveFloorMicroUsdc: reserve === null ? null : String(reserve),
    operatingBudgetMicroUsdc: operating === null ? null : String(operating), remainingOriginalCapacityMicroUsdc: capacity === null ? null : String(capacity),
    coverageShortfallMicroUsdc: shortfall === null ? null : String(shortfall),
    safeNewSpendMicroUsdc: known ? String(min(nonnegative(liquid - protectedAmount - reserve!), capacity!, operating!)) : "0",
    advisorySurplusMicroUsdc: known ? String(nonnegative(liquid - protectedAmount - reserve! - operating!)) : "0",
  });
}

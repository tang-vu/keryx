import type { CreatorEarnings, KeryxDB } from "../db/keryx-db";
import type { Citation, PaymentRecord, QueryRun, Source } from "../types";
import { EXPLORE_SOURCES } from "../public-references/explore-catalog";
import { PAPER_CATALOG } from "../papers/catalog";
import { privacyReadsActive, requirePrivacy } from "../run-privacy/contracts";
import { canonicalSourceUrl } from "./public-source-claim";
import { hasKnownSyntheticFingerprint } from "../research/evidence-provenance";

export interface SourceLeaderboardRow {
  sourceId: string;
  sourceName: string;
  href: string;
  kind: "creator" | "public-reference" | "explore" | "paper";
  walletAddress?: string;
  creatorEarnedUsdc: number;
  paymentCount: number;
  citationCount: number;
  /** Allocated share of an actual Keryx transfer, never a payment to this publisher. */
  operatingFeeUsdc: number | null;
  operatingFeePaymentCount: number | null;
  operatingFeeCitationCount: number | null;
  feeBeneficiaries: string[];
}

export interface SourceLeaderboard {
  rows: SourceLeaderboardRow[];
  catalogStatus: "ready" | "unavailable";
  operatingFeesStatus: "ready" | "incomplete" | "unavailable";
  operatingFeeNetwork: string;
}

type Reader = Pick<KeryxDB, "listPublicReferences" | "listPaymentsBySource" | "getQueryRun" | "runPrivacy" | "runPrivacyActive">;
const FEE_SOURCE_ID = "keryx:operating-fee";

function micro(value: number): number | null {
  const scaled = value * 1e6;
  const rounded = Math.round(scaled);
  return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(rounded)
    && Math.abs(scaled - rounded) < 1e-6 ? rounded : null;
}

function publicUrl(value: string | undefined): string | null {
  if (!value) return null;
  try { return canonicalSourceUrl(value); } catch { return null; }
}

/** Validate the entire original before crediting any share. Ledger finality is authoritative. */
export function settledFeeAllocations(payment: PaymentRecord, run: QueryRun): Array<{ citation: Citation; amountMicro: number }> | null {
  const fee = run.operatingFee;
  const amount = micro(payment.amountUsdc);
  if (payment.kind !== "operating-fee" || payment.sourceId !== FEE_SOURCE_ID || !payment.settled
    || payment.settlementStatus !== "settled" || !payment.txHash?.trim()
    || !payment.id || run.id !== payment.queryId || !fee || fee.policy !== "public-citation-operating-fee-v1"
    || fee.paymentId !== payment.id || fee.status !== "settled" || micro(fee.amountUsdc) !== amount || !amount
    || !/^0x[\da-f]{40}$/i.test(payment.payee) || typeof fee.beneficiary !== "string" || fee.beneficiary.toLowerCase() !== payment.payee.toLowerCase()
    || !Array.isArray(fee.allocations) || !fee.allocations.length || !Array.isArray(run.citations)) return null;
  const matched: Array<{ citation: Citation; amountMicro: number }> = [];
  const markers = new Set<string>();
  for (const allocation of fee.allocations) {
    const share = micro(allocation.amountUsdc);
    const url = publicUrl(allocation.itemUrl);
    const citations = run.citations.filter(c => c.marker === allocation.marker && c.sourceId === allocation.sourceId);
    const citation = citations[0];
    if (!share || !url || markers.has(allocation.marker) || citations.length !== 1
      || citation.sourceKind !== "public-reference" || citation.evidenceProvenance === "synthetic-demo"
      || hasKnownSyntheticFingerprint(citation) || publicUrl(citation.itemUrl) !== url) return null;
    markers.add(allocation.marker);
    matched.push({ citation, amountMicro: share });
  }
  const total = matched.reduce((sum, share) => sum + share.amountMicro, 0);
  return Number.isSafeInteger(total) && total === amount ? matched : null;
}

/** Display only. No registry/payee mutation, settlement, replay, or private text projection. */
export async function loadSourceLeaderboard(db: Reader, input: {
  sources: Source[]; earnings: CreatorEarnings[]; network: string;
}): Promise<SourceLeaderboard> {
  const rows = new Map<string, SourceLeaderboardRow>();
  const add = (id: string, name: string, href: string, kind: SourceLeaderboardRow["kind"], walletAddress?: string) => {
    if (!rows.has(id)) rows.set(id, { sourceId: id, sourceName: name, href, kind, walletAddress,
      creatorEarnedUsdc: 0, paymentCount: 0, citationCount: 0, operatingFeeUsdc: 0,
      operatingFeePaymentCount: 0, operatingFeeCitationCount: 0, feeBeneficiaries: [] });
  };
  for (const source of input.sources) add(source.id, source.name, `/creator/${encodeURIComponent(source.id)}`, "creator", source.walletAddress);
  for (const earned of input.earnings) {
    add(earned.sourceId, earned.sourceName, `/creator/${encodeURIComponent(earned.sourceId)}`, "creator", earned.walletAddress);
    Object.assign(rows.get(earned.sourceId)!, { creatorEarnedUsdc: earned.totalEarnedUsdc,
      paymentCount: earned.paymentCount, citationCount: earned.citationCount, walletAddress: earned.walletAddress });
  }
  const [references, payments] = await Promise.allSettled([
    Promise.resolve().then(() => {
      if (!db.listPublicReferences) throw new Error("Public catalog unavailable");
      return db.listPublicReferences();
    }),
    Promise.resolve().then(() => db.listPaymentsBySource(FEE_SOURCE_ID)),
  ]);
  if (references.status === "fulfilled") for (const reference of references.value) {
    if (reference.active) add(reference.id, reference.name, reference.url, "public-reference");
  }
  // These records are public discovery metadata, with no ownership or payout authority.
  for (const source of EXPLORE_SOURCES) add(source.id, source.name, source.url, "explore");
  for (const paper of PAPER_CATALOG) add(`paper:${paper.url}`, paper.title, paper.url, "paper");

  let operatingFeesStatus: SourceLeaderboard["operatingFeesStatus"] = payments.status === "fulfilled" ? "ready" : "unavailable";
  const sums = new Map<string, { micro: number; payments: Set<string>; citations: number; beneficiaries: Set<string> }>();
  const seen = new Set<string>();
  if (payments.status === "fulfilled") for (const payment of payments.value) {
    if (payment.kind !== "operating-fee" || payment.sourceId !== FEE_SOURCE_ID || payment.network !== input.network
      || !payment.settled || payment.settlementStatus !== "settled" || !payment.txHash?.trim()) continue;
    if (!payment.id) { operatingFeesStatus = "incomplete"; continue; }
    if (seen.has(payment.id)) continue;
    seen.add(payment.id);
    try {
      let run: QueryRun | null;
      if (privacyReadsActive(db)) {
        const value = await requirePrivacy(db).read(payment.queryId);
        run = value.item?.state.visibility === "public" && !value.item.state.erased ? value.item.run : null;
      } else run = await db.getQueryRun(payment.queryId);
      if (!run || /^prv_/i.test(run.id)) { operatingFeesStatus = "incomplete"; continue; }
      const allocations = settledFeeAllocations(payment, run);
      if (!allocations) { operatingFeesStatus = "incomplete"; continue; }
      for (const { citation, amountMicro } of allocations) {
        add(citation.sourceId, citation.sourceName, publicUrl(citation.itemUrl)!, "public-reference");
        const sum = sums.get(citation.sourceId) ?? { micro: 0, payments: new Set<string>(), citations: 0, beneficiaries: new Set<string>() };
        sum.micro += amountMicro;
        if (!Number.isSafeInteger(sum.micro)) throw new Error("Source fee total exceeds exact integer range");
        sum.payments.add(payment.id);
        sum.citations++;
        sum.beneficiaries.add(payment.payee);
        sums.set(citation.sourceId, sum);
      }
    } catch { operatingFeesStatus = "incomplete"; }
  }
  for (const row of rows.values()) {
    const sum = sums.get(row.sourceId);
    // Unknown associations can belong to any source: never publish a partial all-time zero/total.
    row.operatingFeeUsdc = operatingFeesStatus === "ready" ? (sum?.micro ?? 0) / 1e6 : null;
    row.operatingFeePaymentCount = operatingFeesStatus === "ready" ? sum?.payments.size ?? 0 : null;
    row.operatingFeeCitationCount = operatingFeesStatus === "ready" ? sum?.citations ?? 0 : null;
    row.feeBeneficiaries = [...(sum?.beneficiaries ?? [])].sort();
  }
  return { rows: [...rows.values()].sort((a, b) =>
    (b.creatorEarnedUsdc + (b.operatingFeeUsdc ?? 0)) - (a.creatorEarnedUsdc + (a.operatingFeeUsdc ?? 0))
    || a.sourceName.localeCompare(b.sourceName) || a.sourceId.localeCompare(b.sourceId)),
    catalogStatus: references.status === "fulfilled" ? "ready" : "unavailable", operatingFeesStatus, operatingFeeNetwork: input.network };
}

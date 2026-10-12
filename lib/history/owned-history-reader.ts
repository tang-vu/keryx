import { createHash } from "node:crypto";
import type { KeryxDB } from "../db/keryx-db";
import { HistoryError, historyWallet, requirePersonalHistory, type HistoryPosition } from "./personal-history";
import { historyMembershipSchema, historyReceiptSchema, ownedCursorSchema, ownedInputSchema, ownedPageSchema, ownedRowSchema,
  type OwnedHistoryInput, type OwnedHistoryRow } from "./owned-history";
import { requirePrivacy } from "../run-privacy/contracts";
import { runClaimBindingSchema, type RunClaimBinding } from "../run-claims/contracts";
import { validateRunOwnershipHistoryRows } from "../run-claims/history";
import { recordedUsdcMicros } from "../display/recorded-usdc";

export type OwnedHistoryDB = Pick<KeryxDB, "personalHistory" | "runOwnershipHistory" | "runPrivacy" | "runPrivacyActive" | "historyMembership">;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const order = (a: HistoryPosition, b: HistoryPosition) => a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1;
async function authority(db: OwnedHistoryDB, wallet: string) {
  const raw = await db.historyMembership?.resolve(wallet);
  if (!raw) return { wallets: [wallet], membership: null };
  const membership = historyMembershipSchema.parse(raw), wallets = [...membership.wallets].sort();
  if (!wallets.includes(wallet) || new Set(wallets).size !== wallets.length) throw new HistoryError("history_unavailable");
  return { wallets, membership: { accountId: membership.accountId, revision: membership.revision } };
}
/** Shared web/API/MCP reader. Bounded candidate scan, owner-private proof before receipts.
 * Empty filtered pages can have a continuation; neither pagination nor exports promise a snapshot. */
export async function readOwnedHistory(db: OwnedHistoryDB, owner: string, rawBinding: RunClaimBinding, raw: OwnedHistoryInput, signal?: AbortSignal) {
  const deadline = Date.now() + 25_000;
  const check = () => { if (signal?.aborted || Date.now() > deadline) throw new HistoryError("history_unavailable"); };
  check();
  const wallet = historyWallet(owner), binding = runClaimBindingSchema.parse(rawBinding), input = ownedInputSchema.parse(raw);
  const privacy = requirePrivacy(db), store = requirePersonalHistory(db);
  if (!store.receipts) throw new HistoryError("history_unavailable");
  const owners = await authority(db, wallet), authorityHash = hash({ wallet, binding, ...owners, claims: !!db.runOwnershipHistory });
  const { cursor, limit, ...filters } = input, filter = hash(filters);
  let upper: HistoryPosition | undefined, before: HistoryPosition | undefined;
  if (cursor) {
    try {
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error("Cursor encoding");
      const decoded = ownedCursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (decoded.authority !== authorityHash || decoded.filter !== filter || order(decoded.before, decoded.upper) > 0) throw new Error("Cursor binding");
      ({ upper, before } = decoded);
    } catch { throw new HistoryError("invalid_history_query"); }
  }
  const basic = { search: filters.search, surface: filters.surface, from: filters.from, to: filters.to };
  const lists = await Promise.all(owners.wallets.map(async ownerWallet => {
    const query = { binding, filters: basic, take: 51, upper, before };
    const rows = db.runOwnershipHistory
      ? validateRunOwnershipHistoryRows(await db.runOwnershipHistory.list(ownerWallet, query), query)
      : (await store.list(ownerWallet, { ...query })).map(row => ({ ...row, ownership: { method: "recorded" as const, claimedAt: null } }));
    // Apply the same validation to the legacy ordinary projection.
    validateRunOwnershipHistoryRows(rows, query);
    return rows.map(row => ({ row, ownerWallet }));
  }));
  const candidates = lists.flat().sort((a, b) => -order(a.row, b.row));
  check();
  if (new Set(candidates.map(v => v.row.id)).size !== candidates.length) throw new HistoryError("history_unavailable");
  upper ??= candidates[0]?.row && { id: candidates[0].row.id, createdAt: candidates[0].row.createdAt };
  const rows: OwnedHistoryRow[] = [];
  let scanned = 0, last: HistoryPosition | undefined, rowBytes = 0;
  for (const candidate of candidates.slice(0, 50)) {
    check();
    const previous = last;
    scanned++; last = { id: candidate.row.id, createdAt: candidate.row.createdAt };
    const actor = { wallet: candidate.ownerWallet, binding }, item = await privacy.owner(candidate.row.id, actor);
    if (!item || item.state.erased) continue;
    const run = item.run;
    if (run.id !== candidate.row.id || run.createdAt !== candidate.row.createdAt || run.question !== candidate.row.question) throw new HistoryError("history_unavailable");
    if (filters.visibility && item.state.visibility !== filters.visibility) continue;
    const payments = (await store.receipts(run.id, 201)).map(value => historyReceiptSchema.parse(value));
    if (payments.length > 201 || payments.some(p => p.queryId !== run.id) || new Set(payments.map(p => p.id)).size !== payments.length) throw new HistoryError("history_unavailable");
    const receiptsTruncated = payments.length > 200;
    const networks = [...new Set(payments.map(p => p.network).filter((v): v is "eip155:5042" | "eip155:5042002" => v === "eip155:5042" || v === "eip155:5042002"))].sort();
    if (filters.network && (filters.network === "unknown" ? payments.length > 0 && payments.every(p => networks.includes(p.network as typeof networks[number])) : !networks.includes(filters.network))) continue;
    const settled = run.paymentMode === "offline" ? [] : payments.filter(p => p.settled && p.settlementStatus === "settled" && !!p.txHash);
    let own = BigInt(0), sponsored = BigInt(0), complete = !receiptsTruncated;
    for (const p of settled) {
      const amount = recordedUsdcMicros(p.amountUsdc);
      if (amount === null || !/^0x[a-f0-9]{40}$/i.test(p.payer) || !/^0x[a-f0-9]{40}$/i.test(p.payee)
        || p.network !== "eip155:5042" && p.network !== "eip155:5042002") { complete = false; continue; }
      if (owners.wallets.includes(p.payer.toLowerCase())) own += amount; else sponsored += amount;
    }
    complete &&= own <= BigInt(Number.MAX_SAFE_INTEGER) && sponsored <= BigInt(Number.MAX_SAFE_INTEGER);
    const funding = !complete ? "unknown" : own > BigInt(0) && sponsored > BigInt(0) ? "mixed" : own > BigInt(0) ? "paid" : sponsored > BigInt(0) ? "sponsored" : "unknown";
    if (filters.funding && funding !== filters.funding) continue;
    const cited = new Set(run.citations.map(c => c.sourceId));
    const paidCreators = settled.filter(p => p.kind === "citation" && cited.has(p.sourceId) && /^0x[a-f0-9]{40}$/i.test(p.payer) && /^0x[a-f0-9]{40}$/i.test(p.payee)
      && (p.network === "eip155:5042" || p.network === "eip155:5042002") && recordedUsdcMicros(p.amountUsdc) !== null && recordedUsdcMicros(p.amountUsdc)! > BigInt(0))
      .slice(0, 200).map(p => ({ sourceId: p.sourceId, name: p.sourceName, payee: p.payee, amountMicros: Number(recordedUsdcMicros(p.amountUsdc)), network: p.network, reference: p.txHash! }));
    const root = `/api/me/asks/${run.id}`;
    const projected = ownedRowSchema.parse({ ...candidate.row, ownerWallet: candidate.ownerWallet, visibility: item.state.visibility, revision: item.state.revision,
      funding, networks, ownSettledSpendMicros: complete && payments.length ? Number(own) : null,
      sponsoredSettledSpendMicros: complete && payments.length ? Number(sponsored) : null, receiptsTruncated, paidCreators,
      links: { report: root, receipts: `${root}?format=receipts`, references: `${root}?format=bibtex`, privacy: `/api/me/run-privacy/${run.id}` } });
    const bytes = Buffer.byteLength(JSON.stringify(projected));
    if (rowBytes + bytes > 1_500_000) {
      if (!rows.length) throw new HistoryError("history_unavailable");
      last = previous; scanned--; break; // Revisit this candidate on the next page; never skip its text.
    }
    rowBytes += bytes; rows.push(projected);
    if (rows.length === limit) break;
  }
  // Unlink/revision change during a read must discard all accumulated private output.
  if (hash(await authority(db, wallet)) !== hash(owners)) throw new HistoryError("history_unavailable");
  check();
  const more = scanned < candidates.length || lists.some(list => list.length === 51);
  const nextCursor = more && upper && last ? Buffer.from(JSON.stringify({ version: 2, authority: authorityHash, filter, upper, before: last })).toString("base64url") : null;
  return ownedPageSchema.parse({ version: 2, wallet, scope: owners.membership ? "account-owned-current-store" : "wallet-owned-current-store",
    membershipAvailable: !!db.historyMembership, claimsAvailable: !!db.runOwnershipHistory, storeNetwork: binding.network, rows, nextCursor, scanLimited: more && rows.length < limit });
}

/** Exact owner detail, including claimed/member runs, without public fallback. */
export async function readOwnedDetail(db: OwnedHistoryDB, owner: string, rawBinding: RunClaimBinding, id: string, signal?: AbortSignal) {
  const wallet = historyWallet(owner), binding = runClaimBindingSchema.parse(rawBinding), owners = await authority(db, wallet), privacy = requirePrivacy(db);
  for (const ownerWallet of owners.wallets) {
    if (signal?.aborted) throw new HistoryError("history_unavailable");
    const item = await privacy.owner(id, { wallet: ownerWallet, binding });
    if (!item || item.state.erased) continue;
    if (hash(await authority(db, wallet)) !== hash(owners)) throw new HistoryError("history_unavailable");
    if (signal?.aborted) throw new HistoryError("history_unavailable");
    return { ...item, wallet, ownerWallet };
  }
  return null;
}

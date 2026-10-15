import { accountSessionContext } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";
import { accountHistoryItem, decodeHistoryCursor, encodeHistoryCursor, type HistoryCursor } from "@/lib/a2a/account-history";
import { pendingOwnerRequestSession } from "@/lib/a2a/pending-owner-session";

export const runtime = "nodejs";

// Owned rows contain the cursor facts, not the original payment authority.
function encodeOwnedHistoryCursor(job: HistoryCursor) {
  const cursor = Buffer.from(JSON.stringify({ createdAt: job.createdAt, id: job.id })).toString("base64url");
  decodeHistoryCursor(cursor);
  return cursor;
}

export async function GET(req: Request) {
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  let before;
  try { before = decodeHistoryCursor(new URL(req.url).searchParams.get("cursor")); }
  catch { return authJson({ error: "Invalid history cursor. Refresh history to start again." }, 400); }
  try {
    if (context.db.pendingJobOwners) {
      const proof = await pendingOwnerRequestSession(req);
      const url = new URL(req.url), owned = url.searchParams.get("pending") === "owned";
      const id = owned ? url.searchParams.get("id") ?? undefined : undefined;
      const rows = await context.db.pendingJobOwners.list(proof, before, id);
      const page = rows.slice(0, 25);
      return authJson({ wallet: context.wallet, jobs: owned ? page : page.map(({ attention, recoveryState, ...job }) => {
        void attention; void recoveryState; return job;
      }), nextCursor: rows.length > 25 ? encodeOwnedHistoryCursor(page[24]) : null,
        ...(owned ? { ownership: "authenticated_original", recoveryState: "unknown" } : {}) });
    }
    if (new URL(req.url).searchParams.get("pending") === "owned") return authJson({ error: "Authenticated pending jobs unavailable" }, 503);
    const rows = await context.db.listA2aOrdersByPayer(context.wallet, before);
    if (rows.some(row => row.payer.toLowerCase() !== context.wallet)) throw new Error("History owner mismatch");
    const page = rows.slice(0, 25);
    if (page.some(order => order.id !== order.queryId)) throw new Error("History original identity mismatch");
    const observedAt = Date.now();
    const jobs = await Promise.all(page.map(async order => {
      // Unavailable/unsupported evidence stays unknown; no fallback reads or reconciliation.
      const attempts = await context.db.listCreatorPaymentAttemptsByQuery(order.queryId).catch(() => null);
      return accountHistoryItem(order, observedAt, attempts);
    }));
    return authJson({ wallet: context.wallet, jobs, nextCursor: rows.length > 25 ? encodeHistoryCursor(page[24]) : null });
  } catch { return authJson({ error: "Paid job history is unavailable. Please retry." }, 503); }
}

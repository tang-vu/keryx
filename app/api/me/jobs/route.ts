import { accountSessionContext } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";
import { accountHistoryItem, decodeHistoryCursor, encodeHistoryCursor } from "@/lib/a2a/account-history";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  let before;
  try { before = decodeHistoryCursor(new URL(req.url).searchParams.get("cursor")); }
  catch { return authJson({ error: "Invalid history cursor. Refresh history to start again." }, 400); }
  try {
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

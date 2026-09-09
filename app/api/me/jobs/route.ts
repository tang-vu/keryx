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
    return authJson({ wallet: context.wallet, jobs: page.map(order => accountHistoryItem(order, Date.now())), nextCursor: rows.length > 25 ? encodeHistoryCursor(page[24]) : null });
  } catch { return authJson({ error: "Paid job history is unavailable. Please retry." }, 503); }
}

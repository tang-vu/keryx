import { accountSessionContext } from "@/lib/account-sessions";
import { requireMainnetGrantOrigin } from "@/lib/payments/mainnet-session-grants";
import { readBoundedRequestJson } from "@/lib/read-bounded-request-json";
import { prepareSessionWithdrawal } from "@/lib/gateway/session-withdrawal-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie, Origin" };
  try { requireMainnetGrantOrigin(request); } catch { return Response.json({ error: "Withdrawal origin refused" }, { status: 403, headers }); }
  const context = await accountSessionContext(); if (context instanceof Response) return context;
  let body; try { body = await readBoundedRequestJson(request, 2048); } catch { return Response.json({ error: "Invalid withdrawal body" }, { status: 400, headers }); }
  try { return Response.json(await prepareSessionWithdrawal(context.db, context.wallet, body, request.signal), { headers }); }
  catch { return Response.json({ error: "Original withdrawal preparation unavailable; retain existing recovery state" }, { status: 503, headers }); }
}

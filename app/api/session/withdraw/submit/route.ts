import { accountSessionContext } from "@/lib/account-sessions";
import { requireMainnetGrantOrigin } from "@/lib/payments/mainnet-session-grants";
import { readBoundedRequestJson } from "@/lib/read-bounded-request-json";
import { sessionWithdrawalSubmitInput } from "@/lib/gateway/session-withdrawal-protocol";
import { submitSessionWithdrawal } from "@/lib/gateway/session-withdrawal-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie, Origin" };
  try { requireMainnetGrantOrigin(request); } catch { return Response.json({ error: "Withdrawal origin refused" }, { status: 403, headers }); }
  const context = await accountSessionContext(); if (context instanceof Response) return context;
  let body; try { body = sessionWithdrawalSubmitInput.parse(await readBoundedRequestJson(request, 2048)); }
  catch { return Response.json({ error: "Invalid original withdrawal signature" }, { status: 400, headers }); }
  try {
    const result = await submitSessionWithdrawal(context.db, context.wallet, body.requestId, body.signature as `0x${string}`, request.signal);
    return Response.json(result ?? { error: "Original withdrawal not found" }, { status: result ? 200 : 404, headers });
  } catch { return Response.json({ error: "Original withdrawal state unavailable; do not sign another burn" }, { status: 503, headers }); }
}

import { accountSessionContext } from "@/lib/account-sessions";
import { mainnetGrantPolicy } from "@/lib/payments/mainnet-session-grants";
import { sessionWithdrawalStatus } from "@/lib/gateway/session-withdrawal-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, params: { params: Promise<{ requestId: string }> }) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie, Origin" };
  const { requestId } = await params.params;
  try {
    const url = new URL(request.url);
    if (!/^0x[0-9a-f]{64}$/.test(requestId) || url.search || url.origin !== mainnetGrantPolicy().origin) throw new Error();
  } catch { return Response.json({ error: "Invalid original withdrawal selector" }, { status: 400, headers }); }
  const context = await accountSessionContext(); if (context instanceof Response) return context;
  try {
    const result = await sessionWithdrawalStatus(context.db, context.wallet, requestId, request.signal);
    return Response.json(result ?? { error: "Original withdrawal not found" }, { status: result ? 200 : 404, headers });
  } catch { return Response.json({ error: "Original withdrawal evidence unavailable" }, { status: 503, headers }); }
}

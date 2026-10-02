import { z } from "zod";
import { accountSessionContext } from "@/lib/account-sessions";
import { requireMainnetGrantOrigin } from "@/lib/payments/mainnet-session-grants";
import { readBoundedRequestJson } from "@/lib/read-bounded-request-json";
import { completeSessionWithdrawal } from "@/lib/gateway/session-withdrawal-service";
export const runtime = "nodejs";
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const schema = z.object({ requestId: hash, transactionHash: hash }).strict();
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie, Origin" };
  try { requireMainnetGrantOrigin(request); } catch { return Response.json({ error: "Withdrawal origin refused" }, { status: 403, headers }); }
  const context = await accountSessionContext(); if (context instanceof Response) return context;
  let body; try { body = schema.parse(await readBoundedRequestJson(request, 2048)); }
  catch { return Response.json({ error: "Invalid original mint selector" }, { status: 400, headers }); }
  try {
    const result = await completeSessionWithdrawal(context.db, context.wallet, body.requestId, body.transactionHash as `0x${string}`, request.signal);
    return Response.json(result ?? { error: "Original withdrawal not found" }, { status: result ? 200 : 404, headers });
  } catch { return Response.json({ error: "Original finalized mint evidence unavailable; keep recovery state" }, { status: 503, headers }); }
}

import { NextRequest } from "next/server";
import { accountSessionContext } from "@/lib/account-sessions";
import { issueMainnetSessionGrant, requireMainnetGrantOrigin } from "@/lib/payments/mainnet-session-grants";
import { readBoundedJson } from "@/lib/read-bounded-json";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try { requireMainnetGrantOrigin(req); } catch { return Response.json({ error: "Grant deployment or origin refused" }, { status: 403, headers }); }
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  let body;
  try { body = await readBoundedJson(new Response(req.body), 8192); }
  catch { return Response.json({ error: "Invalid grant challenge body" }, { status: 400, headers }); }
  try { return Response.json(await issueMainnetSessionGrant(context.db, context.wallet, body), { headers }); }
  catch { return Response.json({ error: "Verified session funding or durable grant admission is unavailable" }, { status: 503, headers }); }
}

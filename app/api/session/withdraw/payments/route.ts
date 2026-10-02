import { accountSessionContext } from "@/lib/account-sessions";
import { mainnetGrantPolicy } from "@/lib/payments/mainnet-session-grants";
import { readRetainedMainnetSessionAuthority } from "@/lib/payments/retained-session-authority";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie, Origin" };
  let signer: string, epoch: string, cursor: string | undefined;
  try {
    const url = new URL(request.url), query = url.searchParams;
    if (url.origin !== mainnetGrantPolicy().origin || [...query.keys()].some(k => !["sessAddr", "grantEpoch", "afterNonce"].includes(k) || query.getAll(k).length !== 1)) throw new Error();
    signer = z.string().regex(/^0x[0-9a-f]{40}$/).parse(query.get("sessAddr")); epoch = z.string().uuid().parse(query.get("grantEpoch"));
    cursor = z.string().regex(/^0x[0-9a-f]{64}$/).optional().parse(query.get("afterNonce") ?? undefined);
  } catch { return Response.json({ error: "Invalid original liability selector" }, { status: 400, headers }); }
  const context = await accountSessionContext(); if (context instanceof Response) return context;
  try {
    await readRetainedMainnetSessionAuthority(context.db, context.wallet, epoch, signer);
    const result = await context.db.listSessionWithdrawalPayments(signer, cursor, 64);
    if (result.payments.some(p => p.sessionId !== context.wallet)) throw new Error();
    return Response.json({ ...result, network: "eip155:5042", sessAddr: signer, retryAuthorized: false }, { headers });
  } catch { return Response.json({ error: "Original liability evidence unavailable" }, { status: 503, headers }); }
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { getPendingChallenge } from "@/lib/payments/pending-signatures";
import { requireMainnetGrantOrigin } from "@/lib/payments/mainnet-session-grants";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { canonicalJson } from "@/lib/canonical-json";
export const runtime = "nodejs";
const bodySchema = z.object({ reqId: z.string().uuid() }).strict();
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try { requireMainnetGrantOrigin(req); } catch { return Response.json({ error: "Challenge origin refused" }, { status: 403, headers }); }
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  let reqId;
  try { ({ reqId } = bodySchema.parse(await readBoundedJson(new Response(req.body), 4096))); }
  catch { return Response.json({ error: "Invalid admitted request selector" }, { status: 400, headers }); }
  try {
    const grant = await context.db.getSessionGrant(context.wallet), journal = await context.db.getBrowserJournal(context.wallet, reqId);
    const live = getPendingChallenge(context.wallet, reqId);
    if (!grant || grant.expiry <= Date.now() || !journal || journal.phase !== "exposed" || !live ||
      journal.grantEpoch !== grant.grantEpoch || journal.signer.toLowerCase() !== grant.sessAddr.toLowerCase() ||
      journal.requirements.network !== config.profile.networkId || live.expectedNonce !== journal.nonce ||
      live.expectedSigner.toLowerCase() !== journal.signer.toLowerCase() ||
      canonicalJson(live.requirements) !== canonicalJson(journal.requirements))
      return Response.json({ error: "Original live authorization is unavailable" }, { status: 409, headers });
    const payment = journal.payment;
    return Response.json({ sessionId: context.wallet, reqId, grantEpoch: journal.grantEpoch, sessAddr: journal.signer,
      sourceId: payment.sourceId, kind: payment.kind, expectedNonce: journal.nonce, browserAuthorizationProtocol: "durable-v1",
      requirements: journal.requirements, ...(journal.paymentContext ? { paymentContext: journal.paymentContext } : {}) }, { headers });
  } catch { return Response.json({ error: "Original authorization storage is unavailable" }, { status: 503, headers }); }
}

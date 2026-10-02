import { NextRequest } from "next/server";
import { z } from "zod";
import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { ARC_MAINNET_PROFILE } from "@/lib/arc-network-profile";
import { mainnetGrantPolicy } from "@/lib/payments/mainnet-session-grants";
import { readRetainedMainnetSessionAuthority } from "@/lib/payments/retained-session-authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Original owner-scoped state only. Expiry/revoke/replacement cannot erase this
 * recovery view, and reading it never admits a retry, nonce or new signature. */
export async function GET(req: NextRequest, context: { params: Promise<{ reqId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  if (config.profile !== ARC_MAINNET_PROFILE) return Response.json({ error: "Authorization recovery unavailable" }, { status: 404, headers });
  let reqId: string;
  try {
    reqId = z.string().uuid().parse((await context.params).reqId);
    if (new URL(req.url).origin !== mainnetGrantPolicy().origin || req.nextUrl.search) throw new Error();
  } catch { return Response.json({ error: "Invalid original authorization selector" }, { status: 400, headers }); }
  const owner = await accountSessionContext();
  if (owner instanceof Response) return owner;
  try {
    const journal = await owner.db.getBrowserJournal(owner.wallet, reqId);
    if (!journal) return Response.json({ error: "Original authorization not found" }, { status: 404, headers });
    const proof = await readRetainedMainnetSessionAuthority(owner.db, owner.wallet, journal.grantEpoch, journal.signer.toLowerCase());
    const consent = proof.consent;
    if (journal.sessionId !== owner.wallet || journal.signer.toLowerCase() !== consent.sessAddr || consent.ownerAddr !== owner.wallet ||
      consent.origin !== mainnetGrantPolicy().origin || journal.requirements.network !== ARC_MAINNET_PROFILE.networkId ||
      journal.payment.network !== ARC_MAINNET_PROFILE.networkId || journal.payment.authorizationId !== journal.nonce ||
      journal.requestId !== reqId || consent.grantEpoch !== journal.grantEpoch) throw new Error();
    const payment = journal.payment;
    const settlementConfirmed = journal.phase === "settled" && payment.settled === true && payment.settlementStatus === "settled" &&
      typeof payment.txHash === "string" && payment.txHash.length > 0;
    if (journal.phase === "settled" && !settlementConfirmed) throw new Error();
    return Response.json({ journal, authorization: proof, settlementConfirmed,
      statusAuthority: "retained-journal-only", retryAuthorized: false }, { headers });
  } catch { return Response.json({ error: "Original authorization evidence unavailable" }, { status: 503, headers }); }
}

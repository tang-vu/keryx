import { z } from "zod";
import { getSession } from "@/lib/auth";
import { authJson } from "@/lib/auth-challenge";
import { circleUserTokenSchema, verifiedCircleWallet, circleRequest, guardCirclePost, readCircleBody, circleFailure } from "@/lib/circle-wallet-server";
import { circleRecoveryQuerySchema, listCircleRecoveryTransactions } from "@/lib/circle-wallet-recovery";

export const runtime = "nodejs";
const schema = z.object({ userToken: circleUserTokenSchema, query: circleRecoveryQuerySchema }).strict();

/** POST keeps the ephemeral vendor credential out of URLs. All vendor calls are GETs. */
export async function POST(request: Request) {
  const denied = await guardCirclePost(request); if (denied) return denied;
  const session = await getSession(); if (!session) return authJson({ error: "Sign in before inspecting the Google wallet" }, 401);
  const body = await readCircleBody(request, schema).catch(() => null);
  if (!body) return authJson({ error: "Invalid recovery query" }, 400);
  try {
    const wallet = await verifiedCircleWallet(body.userToken);
    if (!wallet || wallet.address.toLowerCase() !== session.address.toLowerCase()) return authJson({ error: "Google wallet differs from the signed-in account" }, 403);
    const page = await listCircleRecoveryTransactions({ wallet, query: body.query,
      request: path => circleRequest(path, { userToken: body.userToken }) });
    return authJson(page);
  } catch (error) { return circleFailure(error); }
}

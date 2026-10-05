import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authJson } from "@/lib/auth-challenge";
import { circleBlockchain, circleLoginCookieMatches, circleLoginStateSchema, circleUserTokenSchema, circleRequest, verifiedCircleWallet, guardCirclePost, readCircleBody, circleFailure } from "@/lib/circle-wallet-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = await guardCirclePost(request); if (denied) return denied;
  const body = await readCircleBody(request, z.object({ userToken: circleUserTokenSchema, state: circleLoginStateSchema }).strict()).catch(() => null);
  if (!body) return authJson({ error: "invalid wallet initialization" }, 400);
  if (!await circleLoginCookieMatches(body.state)) return authJson({ error: "login request expired; start again" }, 401);
  try {
    const wallet = await verifiedCircleWallet(body.userToken);
    if (wallet) return authJson({ ready: true });
    const data = await circleRequest("user/initialize", { userToken: body.userToken,
      body: { idempotencyKey: randomUUID(), accountType: "EOA", blockchains: [circleBlockchain()] } });
    const challengeId = z.string().uuid().parse(data.challengeId);
    return authJson({ ready: false, challengeId });
  } catch (error) { return circleFailure(error); }
}

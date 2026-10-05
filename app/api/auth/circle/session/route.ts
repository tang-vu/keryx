import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { resolveRole } from "@/lib/auth";
import { issueWebSession } from "@/lib/auth-session";
import { recordActivationEvent } from "@/lib/activation";
import { authJson } from "@/lib/auth-challenge";
import { CIRCLE_LOGIN_COOKIE, circleLoginHash, circleLoginCookieMatches, circleLoginStateSchema, circleUserTokenSchema, verifiedCircleWallet, guardCirclePost, readCircleBody, circleFailure } from "@/lib/circle-wallet-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = await guardCirclePost(request); if (denied) return denied;
  const body = await readCircleBody(request, z.object({ userToken: circleUserTokenSchema, state: circleLoginStateSchema }).strict()).catch(() => null);
  if (!body) return authJson({ error: "invalid Google login" }, 400);
  if (!await circleLoginCookieMatches(body.state)) return authJson({ error: "login request expired; start again" }, 401);
  try {
    const wallet = await verifiedCircleWallet(body.userToken);
    if (!wallet) return authJson({ error: "Wallet creation is still pending; finish the Circle confirmation" }, 409);
    const db = await getDb();
    if (!await db.consumeAuthChallenge(circleLoginHash(body.state), Date.now())) return authJson({ error: "login request expired or already used; start again" }, 401);
    (await cookies()).delete(CIRCLE_LOGIN_COOKIE);
    const role = await resolveRole(wallet.address);
    const { created } = await db.upsertUser(wallet.address, role);
    const issued = await issueWebSession(db, config.jwtSecret, wallet.address, role);
    (await cookies()).set("keryx_session", issued.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: issued.maxAge, path: "/" });
    try { await recordActivationEvent(db, "reader_wallet_connected"); } catch { /* Telemetry is best-effort. */ }
    return authJson({ ok: true, address: wallet.address, walletId: wallet.id, role, created });
  } catch (error) { return circleFailure(error); }
}

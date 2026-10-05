import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { authJson } from "@/lib/auth-challenge";
import { CIRCLE_LOGIN_COOKIE, CIRCLE_LOGIN_TTL_MS, circleLoginHash, circleRequest, guardCirclePost, readCircleBody, circleFailure } from "@/lib/circle-wallet-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = await guardCirclePost(request); if (denied) return denied;
  const body = await readCircleBody(request, z.object({ deviceId: z.string().uuid() }).strict()).catch(() => null);
  if (!body) return authJson({ error: "invalid device request" }, 400);
  try {
    const data = await circleRequest("users/social/token", { body: { idempotencyKey: randomUUID(), deviceId: body.deviceId } });
    const device = z.object({ deviceToken: z.string().min(1).max(8192), deviceEncryptionKey: z.string().min(1).max(8192) }).parse(data);
    const state = randomBytes(32).toString("hex"); const now = Date.now();
    await (await getDb()).createAuthChallenge(circleLoginHash(state), now, now + CIRCLE_LOGIN_TTL_MS);
    (await cookies()).set(CIRCLE_LOGIN_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: CIRCLE_LOGIN_TTL_MS / 1000, path: "/" });
    return authJson({ ...device, state, expiresAt: now + CIRCLE_LOGIN_TTL_MS });
  } catch (error) { return circleFailure(error); }
}

/**
 * GET /api/auth/nonce
 *
 * Issues a five-minute SIWE challenge persisted by hash on the server.
 * The cookie binds the browser flow; database consumption supplies single use.
 */

import { generateNonce } from "siwe";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { AUTH_CHALLENGE_TTL_MS, authChallengeHash, authJson } from "@/lib/auth-challenge";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!config.jwtSecret) return authJson({ error: "sign-in unavailable" }, 503);
  const key = createHash("sha256").update(clientIp(req)).digest("hex");
  const limited = await checkRateLimit(`auth-nonce:${key}`, "public");
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const nonce = generateNonce();
  const issuedAt = Date.now();
  try {
    await (await getDb()).createAuthChallenge(authChallengeHash(nonce), issuedAt, issuedAt + AUTH_CHALLENGE_TTL_MS);
  } catch { return authJson({ error: "sign-in unavailable; request a new challenge later" }, 503); }
  const jar = await cookies();

  jar.set("siwe_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 300, // 5 minutes — consumed on first verify attempt
    path: "/",
  });

  return authJson({ nonce });
}

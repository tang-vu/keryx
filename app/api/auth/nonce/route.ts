/**
 * GET /api/auth/nonce
 *
 * Issues a single-use SIWE nonce stored in an httpOnly cookie (5-minute TTL).
 * The cookie is httpOnly so JS cannot read it — the client only receives the
 * nonce value in JSON to embed in the SIWE message it will sign. The server
 * compares against the cookie on /verify, preventing nonce substitution attacks.
 */

import { generateNonce } from "siwe";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  const nonce = generateNonce(); // 96-bit crypto-random base64url string
  const jar = await cookies();

  jar.set("siwe_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 300, // 5 minutes — consumed on first verify attempt
    path: "/",
  });

  return Response.json({ nonce });
}

/**
 * POST /api/auth/signout
 *
 * Revoke this web session before clearing its cookie. An ambiguous database response
 * must not be reported as successful logout. Payment grants have separate authority.
 */

import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { isWebSessionActive, parseWebSession, webSessionHash } from "@/lib/auth-session";
import { authJson } from "@/lib/auth-challenge";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== req.headers.get("host")) return authJson({ error: "origin mismatch" }, 403); }
    catch { return authJson({ error: "bad origin" }, 400); }
  }
  const jar = await cookies();
  const token = jar.get("keryx_session")?.value;
  if (token && !config.jwtSecret) return authJson({ error: "Sign-out could not be confirmed. Please retry." }, 503);
  const claims = await parseWebSession(token, config.jwtSecret);
  if (claims) {
    try {
      const db = await getDb();
      await db.revokeWebSession(webSessionHash(claims.jti), claims.address);
      if (await isWebSessionActive(db, claims)) throw new Error("Session still active after revocation");
    }
    catch { return authJson({ error: "Sign-out could not be confirmed. Please retry." }, 503); }
  }
  // Invalid/expired/legacy cookies cannot authenticate in this release either.
  jar.delete("keryx_session");
  return authJson({ ok: true });
}

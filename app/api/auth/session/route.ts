/**
 * GET /api/auth/session
 *
 * Returns the current session with a FRESH role derived from live env + DB.
 * The role returned here is always current — it does NOT rely on the baked
 * role in the JWT, so wallets added to KERYX_DEV_WALLETS or that just
 * registered a source reflect the correct role without re-login.
 * Returns 401 when no valid session cookie exists.
 */

import { readSessionState, resolveRole } from "@/lib/auth";
import { authJson } from "@/lib/auth-challenge";

export const runtime = "nodejs";

export async function GET() {
  const result = await readSessionState();
  if (result.state === "unavailable") return authJson({ error: "session lookup unavailable" }, 503);
  if (result.state !== "authenticated") return authJson({ session: null }, 401);
  return authJson({ session: { address: result.session.address, role: await resolveRole(result.session.address) } });
}

/**
 * GET /api/auth/session
 *
 * Returns the current session with a FRESH role derived from live env + DB.
 * The role returned here is always current — it does NOT rely on the baked
 * role in the JWT, so wallets added to KERYX_DEV_WALLETS or that just
 * registered a source reflect the correct role without re-login.
 * Returns 401 when no valid session cookie exists.
 */

import { getSessionFresh } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSessionFresh();
  if (!session) {
    return Response.json({ session: null }, { status: 401 });
  }
  return Response.json({ session });
}

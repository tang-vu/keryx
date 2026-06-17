/**
 * GET /api/auth/session
 *
 * Returns the current session payload from the keryx_session JWT cookie.
 * Used by client components that need to know the current role without a
 * full page reload (e.g. register page gate check).
 * Returns 401 when no valid session exists.
 */

import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ session: null }, { status: 401 });
  }
  return Response.json({ session });
}

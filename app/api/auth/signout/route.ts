/**
 * POST /api/auth/signout
 *
 * Clears the keryx_session cookie. Stateless — no server-side session store to
 * invalidate. The JWT may still be technically valid until it expires, but with
 * the cookie gone the browser will not send it on subsequent requests.
 */

import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  jar.delete("keryx_session");
  return Response.json({ ok: true });
}

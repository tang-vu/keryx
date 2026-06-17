/**
 * Server-side auth helpers for route handlers. Reads the keryx_session JWT
 * from the httpOnly cookie set during SIWE verify. Stateless — no DB lookup.
 *
 * getSession() returns null (not throws) on any failure so callers can branch
 * without a try/catch. requireRole() returns a 401 Response when the session
 * is absent or the role doesn't match — callers just `return requireRole(...)`.
 *
 * When JWT_SECRET is unset (offline dev with no env), getSession always returns
 * null. Build still passes; auth simply isn't enforced until the secret is set.
 */

import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { config } from "./config";

export type Role = "creator" | "asker" | "dev";

export interface Session {
  address: string;
  role: Role;
}

/** Returns the decoded session payload, or null if absent/invalid/expired. */
export async function getSession(): Promise<Session | null> {
  if (!config.jwtSecret) return null;

  const token = (await cookies()).get("keryx_session")?.value;
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(config.jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    const address = payload.address as string | undefined;
    const role = payload.role as Role | undefined;
    if (!address || !role) return null;
    return { address, role };
  } catch {
    // Expired, tampered, or wrong secret — treat as unauthenticated.
    return null;
  }
}

/**
 * Returns a 401 Response when the session is missing or the role doesn't match.
 * Returns null when the session is valid and the role matches, so callers can:
 *
 *   const deny = await requireRole('creator');
 *   if (deny) return deny;
 */
export async function requireRole(role: Role): Promise<Response | null> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (session.role !== role) {
    return Response.json(
      { error: "forbidden", required: role, got: session.role },
      { status: 403 },
    );
  }
  return null;
}

/** True when the lowercased address is in the KERYX_DEV_WALLETS allowlist. */
export function isDevWallet(address: string): boolean {
  return config.devWallets.includes(address.toLowerCase());
}

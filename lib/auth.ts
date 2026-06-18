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
 *
 * Role freshness: roles are NEVER read from the JWT's baked `role` claim for
 * access control. resolveRole() re-derives the role live from env + DB at the
 * point of use, so a wallet added to KERYX_DEV_WALLETS or that just registered
 * a source is granted the correct role immediately — no re-login required.
 */

import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { config } from "./config";
import { getDb } from "./db";

export type Role = "creator" | "asker" | "dev";

export interface Session {
  address: string;
  /** Role from the JWT — may be stale. Use resolveRole(address) for gating. */
  role: Role;
}

/**
 * Derives the current role for an address from live sources:
 *   1. dev   — address is in the KERYX_DEV_WALLETS env allowlist (no DB needed)
 *   2. creator — address owns at least one source in the DB
 *   3. asker — everyone else
 *
 * DB errors are caught gracefully: if the DB is unavailable, falls back to
 * dev-allowlist check only (creator → asker). Never throws.
 */
export async function resolveRole(address: string): Promise<Role> {
  if (config.devWallets.includes(address.toLowerCase())) return "dev";
  try {
    const db = await getDb();
    const isCreator = await db.isCreatorWallet(address);
    if (isCreator) return "creator";
  } catch {
    // DB unavailable — degrade to asker rather than crash the request.
  }
  return "asker";
}

/** Returns the decoded session payload (address + JWT's baked role), or null if absent/invalid/expired. */
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
 * Returns the session with a FRESH role resolved from env + DB.
 * Use this whenever the caller needs to display or gate on the current role.
 * Returns null if no valid session cookie exists.
 */
export async function getSessionFresh(): Promise<{ address: string; role: Role } | null> {
  const session = await getSession();
  if (!session) return null;
  const role = await resolveRole(session.address);
  return { address: session.address, role };
}

/**
 * Returns a 401 Response when the session is missing, or 403 when the FRESH
 * role doesn't satisfy the required role. "dev" always satisfies any role check.
 * Returns null when access is granted — callers can:
 *
 *   const deny = await requireRole('creator');
 *   if (deny) return deny;
 */
export async function requireRole(role: Role): Promise<Response | null> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Re-derive role from live env + DB — never trust the JWT's baked claim.
  const freshRole = await resolveRole(session.address);

  // "dev" is a superset: a dev wallet satisfies any role check.
  const allowed = freshRole === role || freshRole === "dev";
  if (!allowed) {
    return Response.json(
      { error: "forbidden", required: role, got: freshRole },
      { status: 403 },
    );
  }
  return null;
}

/** True when the lowercased address is in the KERYX_DEV_WALLETS allowlist. */
export function isDevWallet(address: string): boolean {
  return config.devWallets.includes(address.toLowerCase());
}

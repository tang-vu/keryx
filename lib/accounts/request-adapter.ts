import { parseWebSession, webSessionHash } from "../auth-session";
import type { KeryxDB } from "../db/keryx-db";
import { bindingSchema, interactiveSessionSchema, walletInputSchema, type AccountBinding, type AccountMembershipStore } from "./contracts";
import { accountJson, accountUnavailable, createAccountMembershipRoutes, type AccountRequestAuthority } from "./http";
import { createAccountMembershipService } from "./service";

interface OrdinaryAccountRequestDependencies {
  /** Already initialized/admitted current application facade. Never a getDb resolver,
   * raw connection, provider label, archive reader or request-selected backend. */
  db: Pick<KeryxDB, "accountMembership" | "getWebSession">;
  /** Parent supplies config.baseUrl's exact origin, config.networkId and config.jwtSecret.
   * These values are fixed at assembly, never taken from Host/forwarded headers/body. */
  origin: string;
  network: AccountBinding["network"];
  jwtSecret: string;
}

const unauthenticated = () => accountJson({ error: "account_unauthenticated" }, 401);
const storeMethods = ["offer", "resolve", "resume", "issue", "take", "complete", "unlink", "revokeSession", "assertCurrent"] as const;

function sessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16_384) return undefined;
  let token: string | undefined;
  for (const pair of header.split(";")) {
    const equals = pair.indexOf("=");
    if ((equals < 0 ? pair : pair.slice(0, equals)).trim() !== "keryx_session") continue;
    // Duplicate/ambiguous credentials refuse; do not select the first or last one.
    if (token !== undefined || equals < 0) return undefined;
    token = pair.slice(equals + 1).trim();
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return undefined;
  }
  return token;
}

function ordinaryStore(db: OrdinaryAccountRequestDependencies["db"]): AccountMembershipStore | undefined {
  // Unknown facades, prototype stubs and object-spread copies grant no capability.
  // Only the explicitly published non-enumerable own port is consulted. No init/probe fallback.
  const descriptor = Object.getOwnPropertyDescriptor(db, "accountMembership");
  if (!descriptor || descriptor.enumerable) return undefined;
  const store = db.accountMembership;
  if (!store || storeMethods.some(method => typeof store[method] !== "function")) return undefined;
  return store;
}

/** Browser cookie authority for the precise /api/account/membership parent mount.
 * Local JWT verification and the exact durable web-session API are the only login
 * authority. Account membership, roles, API keys and wallet headers cannot create it.
 * No business IO occurs until request/config/session and the actual port qualify. */
export function createAccountRequestAdapter(deps: OrdinaryAccountRequestDependencies) {
  const { db, origin, network, jwtSecret } = deps;
  const parsedBinding = bindingSchema.safeParse({ origin, network });
  const binding = parsedBinding.success ? Object.freeze(parsedBinding.data) : null;
  const configured = !!binding && typeof jwtSecret === "string" && new TextEncoder().encode(jwtSecret).byteLength >= 32;

  async function authenticate(request: Request): Promise<AccountRequestAuthority | Response> {
    try {
      if (request.headers.has("authorization")) return accountJson({ error: "interactive_account_session_required" }, 401);
      if (!configured || !binding) return accountUnavailable();
      const url = new URL(request.url);
      if (url.origin !== origin || url.pathname !== "/api/account/membership" || url.search || url.hash || request.signal.aborted)
        return accountJson({ error: "invalid_account_request" }, 400);
      if (request.method !== "GET" && request.method !== "POST") {
        const response = accountJson({ error: "invalid_account_request" }, 405);
        response.headers.set("Allow", "GET, POST");
        return response;
      }
      const requestOrigin = request.headers.get("origin");
      if ((request.method === "POST" || requestOrigin !== null) && requestOrigin !== origin)
        return accountJson({ error: "same_origin_required" }, 403);

      const claims = await parseWebSession(sessionCookie(request), jwtSecret);
      if (!claims) return unauthenticated();
      const wallet = walletInputSchema.safeParse(claims.address);
      if (!wallet.success) return unauthenticated();
      const parsedSession = interactiveSessionSchema.safeParse({ sessionHash: webSessionHash(claims.jti), wallet: wallet.data,
        issuedAt: claims.iat * 1000, expiresAt: claims.exp * 1000 });
      if (!parsedSession.success) return unauthenticated();
      const session = Object.freeze(parsedSession.data);
      if (session.issuedAt > Date.now() || session.expiresAt <= Date.now()) return unauthenticated();
      if (request.signal.aborted) return accountJson({ error: "invalid_account_request" }, 400);

      const store = ordinaryStore(db);
      if (!store || typeof db.getWebSession !== "function") return accountUnavailable();
      const row = await db.getWebSession(session.sessionHash);
      const now = Date.now();
      if (!row || row.hash !== session.sessionHash || row.wallet !== session.wallet || row.issuedAt !== session.issuedAt
        || row.expiresAt !== session.expiresAt || session.issuedAt > now || session.expiresAt <= now) return unauthenticated();
      if (request.signal.aborted) return accountJson({ error: "invalid_account_request" }, 400);
      // The unchanged store repeats exact login/schema/current-lineage checks in
      // each transaction. A session revoked after this read gains no stale authority.
      return Object.freeze({ service: createAccountMembershipService(store, binding), session });
    } catch { return accountUnavailable(); }
  }
  return Object.freeze({ origin, authenticate });
}

/** Parent can replace only the refused handlers with this assembly after its final
 * exact-source and operational gates. This module neither selects nor initializes DBs. */
export function createOrdinaryAccountMembershipRoutes(deps: OrdinaryAccountRequestDependencies) {
  return createAccountMembershipRoutes(createAccountRequestAdapter(deps));
}

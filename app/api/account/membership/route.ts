import { parseWebSession, webSessionHash } from "@/lib/auth-session";
import { config } from "@/lib/config";
import { bindingSchema, interactiveSessionSchema, walletInputSchema, type InteractiveSession } from "@/lib/accounts/contracts";
import { accountJson, accountUnavailable } from "@/lib/accounts/http";
import { createOrdinaryAccountMembershipRoutes } from "@/lib/accounts/request-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Capture server configuration only. Request headers/body never select a binding,
// secret, facade or backend. Invalid configuration stays privately unavailable.
const fixed = (() => {
  try {
    const binding = bindingSchema.safeParse({ origin: new URL(config.baseUrl).origin, network: config.networkId });
    const jwtSecret = config.jwtSecret;
    if (!binding.success || typeof jwtSecret !== "string" || new TextEncoder().encode(jwtSecret).byteLength < 32) return null;
    return Object.freeze({ ...binding.data, jwtSecret });
  } catch { return null; }
})();

const unauthenticated = () => accountJson({ error: "account_unauthenticated" }, 401);
const invalidRequest = () => accountJson({ error: "invalid_account_request" }, 400);

/** Same bounded, unique cookie selection as the accepted request adapter. This
 * preflight gates initialization only; the factory still verifies the JWT and
 * exact durable login itself and retains all capability/store freshness fences. */
function sessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16_384) return undefined;
  let token: string | undefined;
  for (const pair of header.split(";")) {
    const equals = pair.indexOf("=");
    if ((equals < 0 ? pair : pair.slice(0, equals)).trim() !== "keryx_session") continue;
    if (token !== undefined || equals < 0) return undefined;
    token = pair.slice(equals + 1).trim();
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return undefined;
  }
  return token;
}

function current(request: Request, session: InteractiveSession): Response | null {
  const now = Date.now();
  if (session.issuedAt > now || session.expiresAt <= now) return unauthenticated();
  return request.signal.aborted ? invalidRequest() : null;
}

async function preflight(request: Request, method: "GET" | "POST"): Promise<InteractiveSession | Response> {
  if (request.headers.has("authorization")) return accountJson({ error: "interactive_account_session_required" }, 401);
  if (!fixed) return accountUnavailable();
  const url = new URL(request.url);
  if (url.origin !== fixed.origin || url.pathname !== "/api/account/membership" || url.search || url.hash || request.signal.aborted)
    return invalidRequest();
  if (request.method !== method) {
    const response = accountJson({ error: "invalid_account_request" }, 405);
    response.headers.set("Allow", "GET, POST");
    return response;
  }
  const origin = request.headers.get("origin");
  if ((method === "POST" || origin !== null) && origin !== fixed.origin)
    return accountJson({ error: "same_origin_required" }, 403);

  const claims = await parseWebSession(sessionCookie(request), fixed.jwtSecret);
  if (!claims) return unauthenticated();
  const wallet = walletInputSchema.safeParse(claims.address);
  if (!wallet.success) return unauthenticated();
  const parsed = interactiveSessionSchema.safeParse({ sessionHash: webSessionHash(claims.jti), wallet: wallet.data,
    issuedAt: claims.iat * 1000, expiresAt: claims.exp * 1000 });
  if (!parsed.success) return unauthenticated();
  const session = Object.freeze(parsed.data);
  return current(request, session) ?? session;
}

async function execute(request: Request, method: "GET" | "POST"): Promise<Response> {
  try {
    const session = await preflight(request, method);
    if (session instanceof Response) return session;
    if (!fixed) return accountUnavailable();
    const beforeImport = current(request, session);
    if (beforeImport) return beforeImport;
    // Import/resolve the existing application owner path only after local
    // authentication. Never construct an adapter or retry on another backend.
    const { getDb } = await import("@/lib/db");
    const beforeDb = current(request, session);
    if (beforeDb) return beforeDb;
    const db = await getDb();
    const afterDb = current(request, session);
    if (afterDb) return afterDb;
    return await createOrdinaryAccountMembershipRoutes({ db, ...fixed })[method](request);
  } catch { return accountUnavailable(); }
}

export function GET(request: Request) { return execute(request, "GET"); }
export function POST(request: Request) { return execute(request, "POST"); }

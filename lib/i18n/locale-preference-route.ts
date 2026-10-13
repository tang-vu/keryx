import { createHash } from "node:crypto";
import { isConfiguredSameOrigin } from "../auth-origin";
import { canonicalLocaleOwner, decodeLocaleValue, encodeLocaleValue, LOCALE_BODY_BYTES, localeScopeKey, parseLocaleBody } from "./locale-preference";
import type { KeryxDB } from "../db/keryx-db";
import type { UiLocale } from "./locales";

type AccountContext = { db: KeryxDB; wallet: string; currentId: string };
export type LocalePreferencePort = { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> };
export interface LocaleRouteDependencies {
  origin: string;
  network: string;
  session(): Promise<AccountContext | Response>;
  port(db: KeryxDB, access: "read" | "write"): Promise<LocalePreferencePort | null>;
}
export function privateLocaleResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Pragma": "no-cache",
    "Vary": "Cookie, Origin, X-Keryx-Expected-Wallet, X-Keryx-Locale-Network", "X-Content-Type-Options": "nosniff" } });
}

/** Hash a bounded locale-only namespace. Neither body owner nor session selector is an account ID. */
export function accountLocaleKey(origin: string, network: string, serverWallet: string): string {
  const scope = localeScopeKey({ origin, network, owner: serverWallet });
  return `keryx:ui-locale:account:v1:${createHash("sha256").update(scope).digest("hex")}`;
}

export function configuredLocaleOrigin(base: unknown): string | null {
  try {
    if (typeof base !== "string" || base.length > 256 || !/^https?:\/\/[^/?#]+\/?$/iu.test(base) || /[\s\\\u0000-\u001f\u007f]/u.test(base)) return null;
    const url = new URL(base);
    return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

/** GET browsers normally omit Origin; exact Fetch Metadata is then mandatory.
 * PUT always requires configured Origin. Host/forwarded headers never grant authority. */
export function localeRequestGate(request: Request, origin: string, network: string): Response | null {
  if (!["GET", "PUT"].includes(request.method)) return privateLocaleResponse({ error: "method_not_allowed" }, 405);
  // No bearer-to-cookie fallback, including malformed/empty bearer headers.
  if (request.headers.has("authorization")) return privateLocaleResponse({ error: "interactive_session_required" }, 401);
  try { localeScopeKey({ origin, network, owner: null }); } catch { return privateLocaleResponse({ error: "locale_unavailable" }, 503); }
  const hasOrigin = request.headers.has("origin");
  if ((request.method === "PUT" || hasOrigin) ? !isConfiguredSameOrigin(request, origin)
    : request.headers.get("sec-fetch-site") !== "same-origin") return privateLocaleResponse({ error: "same_origin_required" }, 403);
  if (!canonicalLocaleOwner(request.headers.get("x-keryx-expected-wallet"))) return privateLocaleResponse({ error: "expected_owner_required" }, 400);
  if (request.headers.get("x-keryx-locale-network") !== network) return privateLocaleResponse({ error: "locale_network_mismatch" }, 409);
  return null;
}

async function readBody(request: Request): Promise<UiLocale | null> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" ||
    request.headers.has("content-encoding") || !request.body) return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d{1,3}$/u.test(length) || Number(length) > LOCALE_BODY_BYTES)) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error("Locale body deadline")); }, 3000); });
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LOCALE_BODY_BYTES) return null;
      chunks.push(part.value);
    }
    const value = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.byteLength; }
    return parseLocaleBody(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)));
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createLocalePreferenceRoute(dependencies: LocaleRouteDependencies) {
  const origin = configuredLocaleOrigin(dependencies.origin);
  return async (request: Request): Promise<Response> => {
    if (!origin) return privateLocaleResponse({ error: "locale_unavailable" }, 503);
    const denied = localeRequestGate(request, origin, dependencies.network);
    if (denied) return denied;
    const expected = canonicalLocaleOwner(request.headers.get("x-keryx-expected-wallet"));
    try {
      // The session boundary validates the cookie JWT before loading its selected DB.
      const account = await dependencies.session();
      if (account instanceof Response) return privateLocaleResponse({ error: account.status === 401 ? "unauthenticated" : "locale_unavailable" }, account.status === 401 ? 401 : 503);
      const owner = canonicalLocaleOwner(account.wallet);
      if (!owner || owner !== expected) return privateLocaleResponse({ error: "account_changed" }, 409);
      const port = await dependencies.port(account.db, request.method === "PUT" ? "write" : "read");
      if (!port) return privateLocaleResponse({ error: "locale_storage_unavailable" }, 503);
      const stillCurrent = async () => {
        const fresh = await dependencies.session();
        return !(fresh instanceof Response) && fresh.db === account.db && fresh.wallet === owner && fresh.currentId === account.currentId;
      };
      const key = accountLocaleKey(origin, dependencies.network, owner);
      const previous = await port.read(key);
      if (previous !== null && !decodeLocaleValue(previous)) return privateLocaleResponse({ error: "locale_value_corrupt" }, 503);
      let locale = decodeLocaleValue(previous);
      if (request.method === "PUT") {
        locale = await readBody(request);
        if (!locale) return privateLocaleResponse({ error: "invalid_locale_preference" }, 400);
        if (!await stillCurrent() || request.signal.aborted) return privateLocaleResponse({ error: "account_changed" }, 409);
        const next = encodeLocaleValue(locale);
        await port.write(key, next);
        if (await port.read(key) !== next) return privateLocaleResponse({ error: "locale_write_unconfirmed" }, 503);
      }
      if (!await stillCurrent() || request.signal.aborted) return privateLocaleResponse({ error: "account_changed" }, 409);
      const header = request.headers.get("accept-language");
      return privateLocaleResponse({ version: 1, locale, owner, network: dependencies.network, origin,
        acceptLanguage: typeof header === "string" && header.length <= 4096 ? header : null });
    } catch { return privateLocaleResponse({ error: "locale_unavailable" }, 503); }
  };
}

/** Installed SQLite facade provenance and current read/write guard, not ENV or duck typing.
 * Other facades stay unavailable; no ordinary adapter construction or storage fallback. */
export async function enrolledSqliteLocalePort(db: KeryxDB, access: "read" | "write", network: string): Promise<LocalePreferencePort | null> {
  try {
    const { applicationSqliteIdentity: assertEnrolledSqliteAdapter } = await import("../db/application-storage");
    const assert = () => { if (assertEnrolledSqliteAdapter(db, access).network !== network) throw new Error("Locale storage realm mismatch"); };
    assert();
    if (typeof db.getSyncState !== "function" || typeof db.setSyncState !== "function") return null;
    return {
      read: async key => { if (!/^keryx:ui-locale:account:v1:[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid locale namespace"); assert(); const value = await db.getSyncState(key); assert(); return value; },
      write: async (key, value) => {
        if (access !== "write" || !/^keryx:ui-locale:account:v1:[a-f0-9]{64}$/u.test(key) || !decodeLocaleValue(value)) throw new Error("Invalid locale storage write");
        assert(); await db.setSyncState(key, value); assert();
      },
    };
  } catch { return null; }
}

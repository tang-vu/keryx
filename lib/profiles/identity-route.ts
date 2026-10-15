import { identityReturnCsp, identityReturnScript } from "./identity-return-policy";
import { hasScope, parseScopes } from "../api-key-scopes";
import { authJson } from "../auth-challenge";
import type { KeryxDB } from "../db/keryx-db";
import { profileWallet } from "./private-profile";
import { authorizationUrl, exchangeIdentity, type ProviderConfiguration } from "./identity-provider";
import { ProfileIdentityError, identityProviderSchema, identityRecordSchema, identitySnapshotSchema, requireProfileIdentities, type IdentityProvider, type ProviderIdentity } from "./verified-identities";
import { flowChallenge, identityCookie, identityCookieValue, identityContinuationCookie, identityContinuationCookieName, newIdentityFlow, readIdentityContinuation, readIdentityFlow, sealIdentityContinuation, sealIdentityFlow, stateMatches, uniqueIdentityCookieValue } from "./identity-flow";
import { emptyIdentityRequestBody } from "./identity-request-body";

interface Context { db: KeryxDB; wallet: string; currentId: string }
interface Dependencies {
  session(): Promise<Context | Response>;
  key(raw: string): Promise<{ walletAddress: string; scopes: string | null; keyId: string } | null>;
  db(): Promise<KeryxDB>;
  provider(provider: IdentityProvider): ProviderConfiguration | null;
  applicationOrigin: string | undefined;
  secret: string;
  now?: () => number;
  exchange?: (config: ProviderConfiguration, input: { code: string; codeVerifier?: string }) => Promise<ProviderIdentity>;
}
function failure(error: unknown): Response {
  const code = error instanceof ProfileIdentityError ? error.code : "identity_unavailable";
  const status = code === "identity_conflict" || code === "profile_required" ? 409 : code === "identity_expired" ? 400 : 503;
  return authJson({ error: code }, status);
}
function safeResponse(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
const callbackPath = (provider: IdentityProvider) => `/api/me/profile/identities/${provider}/callback`;
// Static navigation only. The load event occurs after this queryless document commits.
const continueScript = identityReturnScript;
function continuationDocument(provider: IdentityProvider): Response {
  const response = new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>Continue identity verification</title></head><body><main><h1>Continue identity verification</h1><p>Continue using your signed-in Keryx session.</p><form id="continue" method="post" action="${callbackPath(provider)}"><button type="submit">Continue</button></form></main><script>${continueScript}</script></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": identityReturnCsp,
      "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" },
  });
  // HTTP stays no-referrer at the framework boundary. The committed queryless
  // document meta policy preserves exact form Origin and only its clean referrer.
  return safeResponse(response);
}
function clearIdentityCookies(response: Response, provider: IdentityProvider) {
  response.headers.append("Set-Cookie", identityCookie(provider));
  response.headers.append("Set-Cookie", identityContinuationCookie(provider));
  return safeResponse(response);
}
/** Server configuration only. Never infer browser authority from Next's internal URL or proxy headers. */
function configuredApplicationOrigin(value: string | undefined): string | null {
  try {
    if (!value || value.length > 2048) return null;
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? value : null;
  } catch { return null; }
}
/** OAuth grants identity only. Neither provider ID nor a typed link can create payment/login/creator authority. */
export function createIdentityRoutes(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const applicationOrigin = configuredApplicationOrigin(deps.applicationOrigin);
  const session = async (request: Request, write: boolean) => {
    if (request.headers.has("authorization")) return authJson({ error: "interactive_session_required" }, 403);
    const expected = request.headers.get("x-keryx-expected-wallet");
    if (expected !== null && !/^0x[0-9a-fA-F]{40}$/.test(expected)) return authJson({ error: "invalid_owner_precondition" }, 400);
    if (write) {
      if (!applicationOrigin) return authJson({ error: "identity_unavailable" }, 503);
      if (request.headers.get("origin") !== applicationOrigin) return authJson({ error: "same_origin_required" }, 403);
      if (expected === null) return authJson({ error: "owner_precondition_required" }, 428);
    }
    const context = await deps.session();
    if (!(context instanceof Response) && expected !== null && profileWallet(context.wallet) !== expected.toLowerCase())
      return authJson({ error: "profile_owner_changed" }, 409);
    return context;
  };
  return {
    async GET(request: Request): Promise<Response> {
      try {
        if (new URL(request.url).search) return safeResponse(authJson({ error: "invalid_identity_request" }, 400));
        const header = request.headers.get("authorization");
        let context: { db: KeryxDB; wallet: string } | Response;
        if (header !== null) {
          if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return safeResponse(authJson({ error: "unauthenticated" }, 401));
          const verified = await deps.key(header.slice(7));
          if (!verified) return safeResponse(authJson({ error: "unauthenticated" }, 401));
          if (!hasScope(parseScopes(verified.scopes), "profile:read")) return safeResponse(authJson({ error: "insufficient_scope" }, 403));
          const expected = request.headers.get("x-keryx-expected-wallet");
          if (expected !== null && !/^0x[0-9a-fA-F]{40}$/.test(expected)) return safeResponse(authJson({ error: "invalid_owner_precondition" }, 400));
          if (expected !== null && expected.toLowerCase() !== profileWallet(verified.walletAddress)) return safeResponse(authJson({ error: "profile_owner_changed" }, 409));
          context = { db: await deps.db(), wallet: profileWallet(verified.walletAddress) };
          const value = identitySnapshotSchema.parse(await requireProfileIdentities(context.db).list(context.wallet));
          if (value.wallet !== context.wallet) throw new ProfileIdentityError("identity_unavailable");
          await context.db.incrementUsage(verified.keyId);
          return safeResponse(authJson(value));
        } else context = await session(request, false);
        if (context instanceof Response) return safeResponse(context);
        const value = identitySnapshotSchema.parse(await requireProfileIdentities(context.db).list(context.wallet));
        if (value.wallet !== profileWallet(context.wallet)) throw new ProfileIdentityError("identity_unavailable");
        return safeResponse(authJson(value));
      } catch (error) { return safeResponse(failure(error)); }
    },
    async START(request: Request, providerValue: string): Promise<Response> {
      try {
        const parsed = identityProviderSchema.safeParse(providerValue);
        if (!parsed.success || new URL(request.url).search || !await emptyIdentityRequestBody(request)) return safeResponse(authJson({ error: "invalid_identity_request" }, 400));
        const context = await session(request, true);
        if (context instanceof Response) return safeResponse(context);
        const store = requireProfileIdentities(context.db);
        const config = deps.provider(parsed.data);
        if (!applicationOrigin || !config || deps.secret.length < 32 || config.provider !== parsed.data
          || config.redirectUri !== `${applicationOrigin}/api/me/profile/identities/${parsed.data}/callback`) throw new ProfileIdentityError("identity_unavailable");
        const { state, flow, codeChallenge } = newIdentityFlow(context.wallet, context.currentId, parsed.data, now());
        const token = await sealIdentityFlow(flow, deps.secret, now());
        const url = authorizationUrl(config, state, codeChallenge);
        await store.begin(flowChallenge(flow));
        const response = authJson({ authorizationUrl: url });
        response.headers.set("Set-Cookie", identityCookie(parsed.data, token));
        response.headers.append("Set-Cookie", identityContinuationCookie(parsed.data));
        return safeResponse(response);
      } catch (error) { return safeResponse(failure(error)); }
    },
    async DELETE(request: Request, providerValue: string): Promise<Response> {
      try {
        const provider = identityProviderSchema.safeParse(providerValue);
        if (!provider.success || new URL(request.url).search || !await emptyIdentityRequestBody(request)) return safeResponse(authJson({ error: "invalid_identity_request" }, 400));
        const context = await session(request, true);
        if (context instanceof Response) return safeResponse(context);
        await requireProfileIdentities(context.db).unlink(context.wallet, provider.data);
        const response = authJson({ unlinked: true });
        return clearIdentityCookies(response, provider.data);
      } catch (error) { return safeResponse(failure(error)); }
    },
    async CALLBACK(request: Request, providerValue: string): Promise<Response> {
      const provider = identityProviderSchema.safeParse(providerValue);
      if (!provider.success) return safeResponse(authJson({ error: "invalid_identity_request" }, 400));
      const result = "failed";
      let returnOrigin: string | undefined;
      try {
        if (!applicationOrigin) throw new ProfileIdentityError("identity_unavailable");
        const config = deps.provider(provider.data);
        if (!config || config.provider !== provider.data
          || config.redirectUri !== `${applicationOrigin}/api/me/profile/identities/${provider.data}/callback`) throw new ProfileIdentityError("identity_unavailable");
        returnOrigin = applicationOrigin;
        const url = new URL(request.url);
        if (request.method !== "GET" || request.headers.has("authorization") || request.signal.aborted) throw new ProfileIdentityError("identity_expired");
        const flowToken = identityCookieValue(request, provider.data);
        const flow = await readIdentityFlow(flowToken, deps.secret, now());
        if (!flow || !flowToken || flow.provider !== provider.data) throw new ProfileIdentityError("identity_expired");
        if (!url.search) {
          const continuation = await readIdentityContinuation(uniqueIdentityCookieValue(request, identityContinuationCookieName(provider.data)), flow, flowToken, deps.secret, now());
          if (!continuation) throw new ProfileIdentityError("identity_expired");
          // Neither this document nor its preceding redirect proves a Strict session.
          return continuationDocument(provider.data);
        }
        if (url.search.length > 4096 || [...url.searchParams.keys()].some(key => !["code", "state", "error", "error_description", "error_uri"].includes(key))
          || [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1)) throw new ProfileIdentityError("identity_expired");
        const state = url.searchParams.get("state"), code = url.searchParams.get("code"), denied = url.searchParams.has("error");
        if (!state || !stateMatches(state, flow)) throw new ProfileIdentityError("identity_expired");
        if (denied) {
          const error = url.searchParams.get("error")!;
          if (code !== null || !error || error.length > 256 || /[\p{Cc}\p{Cf}\s]/u.test(error)
            || (url.searchParams.get("error_description")?.length ?? 0) > 1024 || (url.searchParams.get("error_uri")?.length ?? 0) > 1024) throw new ProfileIdentityError("identity_expired");
        } else if (!code || code.length > 2048 || /[\p{Cc}\p{Cf}\s]/u.test(code)
          || url.searchParams.has("error_description") || url.searchParams.has("error_uri")) throw new ProfileIdentityError("identity_expired");
        const token = await sealIdentityContinuation(flow, flowToken, { denied, ...(denied ? {} : { code: code! }) }, deps.secret, now());
        const response = new Response(null, { status: 303, headers: { Location: config.redirectUri } });
        response.headers.set("Set-Cookie", identityContinuationCookie(provider.data, token));
        return safeResponse(response);
      } catch {}
      const response = returnOrigin ? new Response(null, { status: 303, headers: { Location: `${returnOrigin}/me/profile?identity=${result}` } })
        : authJson({ error: "identity_unavailable" }, 503);
      return clearIdentityCookies(response, provider.data);
    },
    async CALLBACK_POST(request: Request, providerValue: string): Promise<Response> {
      const provider = identityProviderSchema.safeParse(providerValue);
      if (!provider.success) return safeResponse(authJson({ error: "invalid_identity_request" }, 400));
      let result: "verified" | "conflict" | "failed" = "failed";
      let returnOrigin: string | undefined;
      try {
        if (!applicationOrigin) throw new ProfileIdentityError("identity_unavailable");
        const config = deps.provider(provider.data);
        if (!config || config.provider !== provider.data || config.redirectUri !== `${applicationOrigin}${callbackPath(provider.data)}`) throw new ProfileIdentityError("identity_unavailable");
        returnOrigin = applicationOrigin;
        if (request.method !== "POST" || request.url.includes("?") || request.headers.get("origin") !== applicationOrigin
          || request.headers.has("authorization") || !uniqueIdentityCookieValue(request, "keryx_session")
          || !await emptyIdentityRequestBody(request)) throw new ProfileIdentityError("identity_expired");
        const flowToken = identityCookieValue(request, provider.data);
        const flow = await readIdentityFlow(flowToken, deps.secret, now());
        if (!flow || !flowToken || flow.provider !== provider.data) throw new ProfileIdentityError("identity_expired");
        const continuation = await readIdentityContinuation(uniqueIdentityCookieValue(request, identityContinuationCookieName(provider.data)), flow, flowToken, deps.secret, now());
        if (!continuation) throw new ProfileIdentityError("identity_expired");
        const context = await session(request, false);
        if (context instanceof Response || profileWallet(context.wallet) !== flow.wallet || context.currentId !== flow.sessionHash) throw new ProfileIdentityError("identity_expired");
        const store = requireProfileIdentities(context.db), challenge = flowChallenge(flow);
        if (request.signal.aborted || now() >= Date.parse(continuation.expiresAt) || now() >= Date.parse(flow.expiresAt)) throw new ProfileIdentityError("identity_expired");
        await store.consume(challenge); // Consume before any provider call, including denial/error callbacks.
        if (continuation.denied || !continuation.code || request.signal.aborted || now() >= Date.parse(continuation.expiresAt)) throw new ProfileIdentityError("identity_expired");
        const identity = await (deps.exchange ?? exchangeIdentity)(config, { code: continuation.code, ...(flow.codeVerifier ? { codeVerifier: flow.codeVerifier } : {}) });
        if (identity.provider !== provider.data || now() >= Date.parse(flow.expiresAt)) throw new ProfileIdentityError("identity_expired");
        const fresh = await deps.session();
        if (fresh instanceof Response || profileWallet(fresh.wallet) !== flow.wallet || fresh.currentId !== flow.sessionHash) throw new ProfileIdentityError("identity_expired");
        const finalConfig = deps.provider(provider.data);
        if (!finalConfig || finalConfig.provider !== config.provider || finalConfig.redirectUri !== config.redirectUri
          || finalConfig.clientId !== config.clientId || finalConfig.clientSecret !== config.clientSecret
          || request.signal.aborted || now() >= Date.parse(flow.expiresAt) || now() >= Date.parse(continuation.expiresAt)) throw new ProfileIdentityError("identity_expired");
        const record = identityRecordSchema.parse(await store.complete(challenge, identity));
        if (record.wallet !== flow.wallet || record.provider !== provider.data || record.externalId !== identity.externalId || record.label !== identity.label)
          throw new ProfileIdentityError("identity_unavailable");
        result = "verified";
      } catch (error) { if (error instanceof ProfileIdentityError && error.code === "identity_conflict") result = "conflict"; }
      // No request-selected return URL and no provider code/token/identity/error detail in redirects.
      const response = returnOrigin ? new Response(null, { status: 303, headers: { Location: `${returnOrigin}/me/profile?identity=${result}` } })
        : authJson({ error: "identity_unavailable" }, 503);
      return clearIdentityCookies(response, provider.data);
    },
  };
}

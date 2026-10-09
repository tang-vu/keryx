import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { ProfileIdentityError, providerIdentitySchema, type IdentityProvider, type ProviderIdentity } from "./verified-identities";

export interface ProviderConfiguration {
  provider: IdentityProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const endpoints = Object.freeze({
  github: Object.freeze({ authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token" }),
  orcid: Object.freeze({ authorize: "https://orcid.org/oauth/authorize", token: "https://orcid.org/oauth/token" }),
});
const unavailable = () => new ProfileIdentityError("identity_unavailable");
const safeOpaque = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 &&
  value.length <= max && isWellFormedUtf16(value) && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);

function checkedConfiguration(config: ProviderConfiguration): ProviderConfiguration {
  if (!config || !["github", "orcid"].includes(config.provider) || !safeOpaque(config.clientId, 256) ||
    !safeOpaque(config.clientSecret, 1024) || !safeOpaque(config.redirectUri, 1024)) throw unavailable();
  const redirect = new URL(config.redirectUri);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash || redirect.search) throw unavailable();
  return { provider: config.provider, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri };
}

/** Configuration and OAuth state originate in the trusted session-bound route. */
export function authorizationUrl(config: ProviderConfiguration, state: string, pkceChallenge?: string): string {
  try {
    const checked = checkedConfiguration(config);
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw unavailable();
    const url = new URL(endpoints[checked.provider].authorize);
    url.searchParams.set("client_id", checked.clientId);
    url.searchParams.set("redirect_uri", checked.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    // Omitting scope on GitHub can inherit an application's prior grants.
    url.searchParams.set("scope", checked.provider === "github" ? "" : "/authenticate");
    if (checked.provider === "github") {
      if (typeof pkceChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(pkceChallenge)) throw unavailable();
      url.searchParams.set("code_challenge", pkceChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    } else if (pkceChallenge !== undefined) throw unavailable(); // No documented ORCID PKCE claim.
    return url.href;
  } catch { throw unavailable(); }
}

async function boundedJson(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { try { void reader?.cancel().catch(() => {}); } catch { /* Refusal never waits for transport cleanup. */ } };
  controller.signal.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, REQUEST_TIMEOUT_MS);
  });
  try {
    const request = (async () => {
      const response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || response.status !== 200 || response.redirected || (response.url && response.url !== url)) {
        try { void response.body?.cancel().catch(() => {}); } catch { /* Best-effort disposal only. */ }
        throw unavailable();
      }
      const mime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      const length = response.headers.get("content-length");
      if (!["application/json", "application/vnd.github+json"].includes(mime ?? "") || !response.body ||
        (length !== null && (!/^(?:0|[1-9]\d*)$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_RESPONSE_BYTES))) {
        try { void response.body?.cancel().catch(() => {}); } catch { /* Best-effort disposal only. */ }
        throw unavailable();
      }
      const declaredScopes = response.headers.get("x-oauth-scopes");
      if (url === "https://api.github.com/user" && declaredScopes !== null && declaredScopes !== "") {
        try { void response.body.cancel().catch(() => {}); } catch { /* Best-effort disposal only. */ }
        throw unavailable();
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw unavailable();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw unavailable();
        total += chunk.value.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw unavailable();
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      return value as Record<string, unknown>;
    })();
    return await Promise.race([request, deadline]);
  } catch { throw unavailable(); }
  finally {
    clearTimeout(timer);
    cancel();
    try { reader?.releaseLock(); } catch { /* A timed-out read may still be settling. */ }
    controller.signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}

/** Returns identity only. Tokens, refresh fields and all other provider data remain ephemeral. */
export async function exchangeIdentity(config: ProviderConfiguration, input: { code: string; codeVerifier?: string }, fetcher: typeof fetch = fetch): Promise<ProviderIdentity> {
  try {
    const checked = checkedConfiguration(config);
    if (!input || !safeOpaque(input.code, 4096)) throw unavailable();
    if (checked.provider === "github" ? typeof input.codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)
      : input.codeVerifier !== undefined) throw unavailable();
    const form = new URLSearchParams({ client_id: checked.clientId, client_secret: checked.clientSecret, code: input.code, redirect_uri: checked.redirectUri });
    if (checked.provider === "github") form.set("code_verifier", input.codeVerifier!);
    else form.set("grant_type", "authorization_code");
    const token = await boundedJson(endpoints[checked.provider].token, { method: "POST", headers: {
      Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Keryx-profile-identity",
    }, body: form.toString() }, fetcher);
    if ("error" in token || token.scope !== (checked.provider === "github" ? "" : "/authenticate") ||
      typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer" ||
      typeof token.access_token !== "string" || token.access_token.length > 4096 || !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(token.access_token)) throw unavailable();
    let identity: unknown;
    if (checked.provider === "orcid") {
      if (typeof token.orcid !== "string" || (token.name !== undefined && token.name !== null && typeof token.name !== "string")) throw unavailable();
      const name = token.name;
      // A missing name does not invalidate the authenticated identifier. Unsafe names still refuse.
      if (typeof name === "string" && (name.length > 160 || !isWellFormedUtf16(name) || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))) throw unavailable();
      identity = { provider: "orcid", externalId: token.orcid, label: typeof name === "string" && name.trim() ? name : token.orcid };
    } else {
      const user = await boundedJson("https://api.github.com/user", { method: "GET", headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "Keryx-profile-identity", "X-GitHub-Api-Version": "2026-03-10",
      } }, fetcher);
      if ("error" in user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) throw unavailable();
      identity = { provider: "github", externalId: String(user.id), label: user.login };
    }
    const parsed = providerIdentitySchema.safeParse(identity);
    if (!parsed.success) throw unavailable();
    return parsed.data;
  } catch { throw unavailable(); }
}

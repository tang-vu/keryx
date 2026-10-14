import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { identityChallengeSchema, type IdentityChallenge, type IdentityProvider } from "./verified-identities";
import type { ProviderConfiguration } from "./identity-provider";

export const IDENTITY_FLOW_SECONDS = 300;
export const identityStateHash = (state: string) => createHash("sha256").update(`keryx-profile-identity-v1:${state}`).digest("hex");
const flowSchema = identityChallengeSchema.extend({ codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).strict();
export type IdentityFlow = z.infer<typeof flowSchema>;
const key = (secret: string) => {
  if (secret.length < 32) throw new Error("Identity flow unavailable");
  return createHash("sha256").update("keryx-profile-identity-cookie-v1:").update(secret).digest();
};
export function newIdentityFlow(wallet: string, sessionHash: string, provider: IdentityProvider, now: number) {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = provider === "github" ? randomBytes(32).toString("base64url") : undefined;
  const flow = flowSchema.parse({ wallet, sessionHash, provider, stateHash: identityStateHash(state),
    expiresAt: new Date(now + IDENTITY_FLOW_SECONDS * 1000).toISOString(), ...(codeVerifier ? { codeVerifier } : {}) });
  return { state, flow, codeChallenge: codeVerifier ? createHash("sha256").update(codeVerifier).digest("base64url") : undefined };
}
export const flowChallenge = (flow: IdentityFlow): IdentityChallenge => identityChallengeSchema.parse({
  wallet: flow.wallet, provider: flow.provider, sessionHash: flow.sessionHash, stateHash: flow.stateHash, expiresAt: flow.expiresAt,
});
export async function sealIdentityFlow(flow: IdentityFlow, secret: string, now: number) {
  return new EncryptJWT({ ...flowSchema.parse(flow) }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("keryx-profile-identity").setAudience("keryx-profile-identity-callback")
    .setIssuedAt(Math.floor(now / 1000)).setExpirationTime(Math.floor(Date.parse(flow.expiresAt) / 1000)).encrypt(key(secret));
}
export async function readIdentityFlow(token: string | undefined, secret: string, now: number): Promise<IdentityFlow | null> {
  if (!token || token.length > 2048) return null;
  try {
    const { payload } = await jwtDecrypt(token, key(secret), { issuer: "keryx-profile-identity", audience: "keryx-profile-identity-callback",
      keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"], currentDate: new Date(now) });
    const { iss, aud, iat, exp, ...fields } = payload;
    const flow = flowSchema.parse(fields);
    if (iss !== "keryx-profile-identity" || aud !== "keryx-profile-identity-callback" || typeof iat !== "number" || typeof exp !== "number"
      || iat > now / 1000 || exp !== Math.floor(Date.parse(flow.expiresAt) / 1000) || exp - iat > IDENTITY_FLOW_SECONDS
      || Date.parse(flow.expiresAt) <= now || (flow.provider === "github") !== !!flow.codeVerifier) return null;
    return flow;
  } catch { return null; }
}
export function stateMatches(state: string, flow: IdentityFlow): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(state)
    && timingSafeEqual(Buffer.from(identityStateHash(state), "hex"), Buffer.from(flow.stateHash, "hex"));
}
export const identityCookieName = (provider: IdentityProvider) => `__Host-keryx_identity_${provider}`;
export function identityCookie(provider: IdentityProvider, token = "") {
  return `${identityCookieName(provider)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? IDENTITY_FLOW_SECONDS : 0}`;
}
/** Exact provider cookie only; duplicate cookies cannot choose a different pending flow. */
export function identityCookieValue(request: Request, provider: IdentityProvider): string | undefined {
  return uniqueIdentityCookieValue(request, identityCookieName(provider));
}
export function uniqueIdentityCookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16384) return;
  const matching = header.split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return matching.length === 1 ? matching[0].slice(name.length + 1) : undefined;
}
export const IDENTITY_CONTINUATION_SECONDS = 60;
export const identityContinuationCookieName = (provider: IdentityProvider) => `__Host-keryx_identity_return_${provider}`;
export function identityContinuationCookie(provider: IdentityProvider, token = "") {
  const cookie = `${identityContinuationCookieName(provider)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? IDENTITY_CONTINUATION_SECONDS : 0}`;
  if (Buffer.byteLength(token, "utf8") > 4096 || Buffer.byteLength(cookie, "utf8") > 4096) throw new Error("Identity continuation unavailable");
  return cookie;
}
const continuationSchema = z.object({
  provider: identityChallengeSchema.shape.provider,
  flowHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
  code: z.string().min(1).max(2048).refine(value => !/[\p{Cc}\p{Cf}\s]/u.test(value)).optional(),
  denied: z.boolean(),
}).strict().refine(value => value.denied ? value.code === undefined : value.code !== undefined);
export type IdentityContinuation = z.infer<typeof continuationSchema>;
const continuationKey = (secret: string) => {
  if (secret.length < 32) throw new Error("Identity continuation unavailable");
  return createHash("sha256").update("keryx-profile-identity-continuation-cookie-v1:").update(secret).digest();
};
const flowTokenHash = (token: string) => createHash("sha256").update("keryx-profile-identity-continuation-flow-v1:").update(token).digest("hex");
/** Seals only return metadata, never session authority; binds the exact original PKCE flow. */
export async function sealIdentityContinuation(flow: IdentityFlow, flowToken: string, input: { code?: string; denied: boolean }, secret: string, now: number) {
  const continuation = continuationSchema.parse({ provider: flow.provider, flowHash: flowTokenHash(flowToken),
    expiresAt: new Date(Math.min(Date.parse(flow.expiresAt), now + IDENTITY_CONTINUATION_SECONDS * 1000)).toISOString(), ...input });
  if (Date.parse(continuation.expiresAt) <= now) throw new Error("Identity continuation expired");
  const token = await new EncryptJWT({ ...continuation }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("keryx-profile-identity-continuation").setAudience("keryx-profile-identity-post")
    .setIssuedAt(Math.floor(now / 1000)).setExpirationTime(Math.floor(Date.parse(continuation.expiresAt) / 1000)).encrypt(continuationKey(secret));
  identityContinuationCookie(flow.provider, token); // Check final token and complete cookie bytes before publication.
  return token;
}
export async function readIdentityContinuation(token: string | undefined, flow: IdentityFlow, flowToken: string, secret: string, now: number): Promise<IdentityContinuation | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtDecrypt(token, continuationKey(secret), { issuer: "keryx-profile-identity-continuation", audience: "keryx-profile-identity-post",
      keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"], currentDate: new Date(now) });
    const { iss, aud, iat, exp, ...fields } = payload;
    const value = continuationSchema.parse(fields);
    if (iss !== "keryx-profile-identity-continuation" || aud !== "keryx-profile-identity-post" || typeof iat !== "number" || typeof exp !== "number"
      || iat > now / 1000 || exp <= iat || exp - iat > IDENTITY_CONTINUATION_SECONDS || exp !== Math.floor(Date.parse(value.expiresAt) / 1000)
      || Date.parse(value.expiresAt) <= now || Date.parse(value.expiresAt) > Date.parse(flow.expiresAt) || Date.parse(flow.expiresAt) <= now
      || value.provider !== flow.provider || !timingSafeEqual(Buffer.from(value.flowHash, "hex"), Buffer.from(flowTokenHash(flowToken), "hex"))) return null;
    return value;
  } catch { return null; }
}
/** Fixed deployment configuration. Request Host, query and profile links never select OAuth endpoints/redirects. */
export function identityProviderConfiguration(provider: IdentityProvider, env: Record<string, string | undefined>): ProviderConfiguration | null {
  try {
    const origin = env.KERYX_IDENTITY_OAUTH_ORIGIN;
    if (!origin || new URL(origin).origin !== origin || new URL(origin).protocol !== "https:") return null;
    const prefix = provider === "github" ? "KERYX_GITHUB_OAUTH" : "KERYX_ORCID_OAUTH";
    const clientId = env[`${prefix}_CLIENT_ID`], clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret || clientId.length > 256 || clientSecret.length > 512 || /[\p{Cc}\p{Cf}\s]/u.test(clientId + clientSecret)) return null;
    return { provider, clientId, clientSecret, redirectUri: `${origin}/api/me/profile/identities/${provider}/callback` };
  } catch { return null; }
}

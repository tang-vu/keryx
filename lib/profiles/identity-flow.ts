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
  const header = request.headers.get("cookie");
  if (!header || header.length > 16384) return;
  const matching = header.split(";").map(part => part.trim()).filter(part => part.startsWith(`${identityCookieName(provider)}=`));
  return matching.length === 1 ? matching[0].slice(identityCookieName(provider).length + 1) : undefined;
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

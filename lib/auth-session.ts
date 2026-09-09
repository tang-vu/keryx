import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { KeryxDB, WebSessionRecord } from "./db/keryx-db";

const ISSUER = "keryx-web";
const AUDIENCE = "keryx-account";
export const WEB_SESSION_TTL_MS = 7 * 86400_000;
const claimsSchema = z.object({
  jti: z.string().regex(/^[a-f0-9]{64}$/),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  role: z.enum(["creator", "asker", "dev"]),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(),
}).refine(value => value.exp > value.iat && value.exp - value.iat <= WEB_SESSION_TTL_MS / 1000);
export type WebSessionClaims = z.infer<typeof claimsSchema>;
export const webSessionHash = (id: string) => createHash("sha256").update(`keryx-web-session-v1:${id}`).digest("hex");

export async function parseWebSession(token: string | undefined, secret: string): Promise<WebSessionClaims | null> {
  if (!token || token.length > 4096 || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE, typ: "JWT",
    });
    const claims = claimsSchema.parse(payload);
    if (claims.iat > Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

/** Issue only after durable creation. An interrupted issuance can leave an inaccessible row. */
export async function issueWebSession(db: KeryxDB, secret: string, address: string, role: WebSessionClaims["role"], expiration?: string) {
  const issuedAt = Math.floor(Date.now() / 1000) * 1000;
  const expiresAt = Math.floor(Math.min(issuedAt + WEB_SESSION_TTL_MS, expiration ? Date.parse(expiration) : Infinity) / 1000) * 1000;
  const id = randomBytes(32).toString("hex");
  const claims = claimsSchema.parse({ jti: id, address, role, iat: issuedAt / 1000, exp: expiresAt / 1000 });
  const record: WebSessionRecord = { hash: webSessionHash(id), wallet: address.toLowerCase(), issuedAt, expiresAt };
  if (!secret) throw new Error("Session signing unavailable");
  await db.createWebSession(record);
  const token = await new SignJWT({ address: claims.address, role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setJti(id).setIssuedAt(claims.iat).setExpirationTime(claims.exp).sign(new TextEncoder().encode(secret));
  return { token, maxAge: Math.floor((expiresAt - issuedAt) / 1000) };
}

/** Storage exceptions deliberately propagate; callers must deny authority on an outage. */
export async function isWebSessionActive(db: KeryxDB, claims: WebSessionClaims) {
  const row = await db.getWebSession(webSessionHash(claims.jti));
  const now = Date.now();
  return !!row && row.hash === webSessionHash(claims.jti) && row.wallet === claims.address.toLowerCase() && row.issuedAt === claims.iat * 1000
    && row.expiresAt === claims.exp * 1000 && row.issuedAt <= now && row.expiresAt > now;
}

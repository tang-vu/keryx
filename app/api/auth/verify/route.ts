/**
 * POST /api/auth/verify
 *
 * Consumes an issued, unexpired server challenge and verifies SIWE, then mints a
 * 7-day HS256 JWT into an httpOnly keryx_session cookie.
 *
 * Role derivation (in priority order):
 *   1. dev   — address is in KERYX_DEV_WALLETS env allowlist
 *   2. creator — address owns at least one registered source in the DB
 *   3. asker — everyone else
 *
 * On a successful verify the wallet's account is upserted (created on first
 * sign-in, role + last_seen refreshed thereafter). Account persistence is
 * best-effort after challenge consumption; challenge storage failures deny sign-in.
 *
 * Deleting the cookie alone cannot prevent replay. The durable challenge is consumed
 * atomically before signature verification, including an invalid signature attempt.
 */

import { SiweMessage } from "siwe";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { arcTestnet } from "@/lib/chains";
import { isDevWallet, type Role } from "@/lib/auth";
import { recordActivationEvent } from "@/lib/activation";
import { authChallengeHash, authJson, authNonceSchema, readSignInBody } from "@/lib/auth-challenge";
import { createHash } from "node:crypto";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const jar = await cookies();
  const storedNonce = jar.get("siwe_nonce")?.value;

  // Clear the browser copy too; actual replay prevention is the database operation below.
  jar.delete("siwe_nonce");

  if (!authNonceSchema.safeParse(storedNonce).success) {
    return authJson({ error: "nonce missing or expired" }, 401);
  }

  // Bind the session to this host. An EMPTY Host header would make siwe skip the
  // domain check entirely (it treats a falsy domain as "don't validate"), so reject it.
  const host = req.headers.get("host");
  if (!host) {
    return authJson({ error: "missing host" }, 400);
  }
  // Login-CSRF defense-in-depth beyond SameSite=Strict: if the browser sent an
  // Origin header, its host must match the request host.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        return authJson({ error: "origin mismatch" }, 403);
      }
    } catch {
      return authJson({ error: "bad origin" }, 400);
    }
  }

  if (!config.jwtSecret) return authJson({ error: "sign-in unavailable" }, 503);
  const key = createHash("sha256").update(clientIp(req)).digest("hex");
  const limited = await checkRateLimit(`auth-verify:${key}`, "public");
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const body = await readSignInBody(req).catch(() => null);
  if (!body) return authJson({ error: "invalid sign-in body" }, 400);
  try {
    if (!await (await getDb()).consumeAuthChallenge(authChallengeHash(storedNonce!), Date.now())) {
      return authJson({ error: "nonce missing, expired or already used; sign in again" }, 401);
    }
  } catch { return authJson({ error: "sign-in unavailable; request a new challenge later" }, 503); }

  // The library verifies signature, nonce, domain and supplied expiry. Freshness
  // comes from the server challenge; enforce chainId separately below.
  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(body.message as string);
    const { success, error } = await siwe.verify({
      signature: body.signature as string,
      nonce: storedNonce,
      domain: host,
    });
    if (!success) {
      return authJson({ error: error?.type ?? "verification failed" }, 401);
    }
  } catch {
    return authJson({ error: "invalid siwe message" }, 400);
  }

  // Bind the session to Arc testnet — blocks replay of a signature scoped to another chain.
  if (siwe.chainId !== arcTestnet.id) {
    return authJson({ error: "wrong chain" }, 401);
  }

  // Derive role: dev allowlist first (env-only, no DB), then creator check (DB).
  const address = siwe.address;
  let role: Role = "asker";
  if (isDevWallet(address)) {
    role = "dev";
  } else {
    const db = await getDb();
    const isCreator = await db.isCreatorWallet(address);
    if (isCreator) role = "creator";
  }

  // Create (or refresh) the user account. Best-effort — a DB hiccup here must
  // not block an otherwise-valid sign-in, so failures degrade to created:false.
  let created = false;
  try {
    const db = await getDb();
    ({ created } = await db.upsertUser(address, role));
  } catch {
    // account index unavailable — sign-in still proceeds (stateless JWT).
  }

  const secret = new TextEncoder().encode(config.jwtSecret);
  const jwt = await new SignJWT({ address, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  jar.set("keryx_session", jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 86400, // 7 days in seconds
    path: "/",
  });

  try {
    await recordActivationEvent(await getDb(), "reader_wallet_connected");
  } catch {
    // Aggregate telemetry must never block an otherwise-valid sign-in.
  }

  // `created` lets the client distinguish "account created" from "welcome back".
  return authJson({ ok: true, address, role, created });
}

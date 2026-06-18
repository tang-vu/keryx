/**
 * POST /api/auth/verify
 *
 * Verifies a SIWE signature against the stored nonce cookie, then mints a
 * 7-day HS256 JWT into an httpOnly keryx_session cookie.
 *
 * Role derivation (in priority order):
 *   1. dev   — address is in KERYX_DEV_WALLETS env allowlist
 *   2. creator — address owns at least one registered source in the DB
 *   3. asker — everyone else
 *
 * On a successful verify the wallet's account is upserted (created on first
 * sign-in, role + last_seen refreshed thereafter). Account persistence is
 * best-effort: a DB failure never blocks sign-in.
 *
 * The nonce cookie is deleted immediately after the first verify attempt
 * (whether it succeeds or fails) to prevent replay attacks.
 */

import { SiweMessage } from "siwe";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { arcTestnet } from "@/lib/chains";
import { isDevWallet, type Role } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.message || !body?.signature) {
    return Response.json({ error: "message and signature required" }, { status: 400 });
  }

  const jar = await cookies();
  const storedNonce = jar.get("siwe_nonce")?.value;

  // Always consume the nonce before returning — prevents replay regardless of outcome.
  jar.delete("siwe_nonce");

  if (!storedNonce) {
    return Response.json({ error: "nonce missing or expired" }, { status: 401 });
  }

  // Bind the session to this host. An EMPTY Host header would make siwe skip the
  // domain check entirely (it treats a falsy domain as "don't validate"), so reject it.
  const host = req.headers.get("host");
  if (!host) {
    return Response.json({ error: "missing host" }, { status: 400 });
  }
  // Login-CSRF defense-in-depth beyond SameSite=Strict: if the browser sent an
  // Origin header, its host must match the request host.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        return Response.json({ error: "origin mismatch" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "bad origin" }, { status: 400 });
    }
  }

  // siwe.verify() checks signature recovery, nonce match, domain, issuedAt and
  // expirationTime — but it does NOT validate chainId (the field is ignored), so
  // we enforce chainId ourselves after a successful verify.
  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(body.message as string);
    const { success, error } = await siwe.verify({
      signature: body.signature as string,
      nonce: storedNonce,
      domain: host,
    });
    if (!success) {
      return Response.json({ error: error?.type ?? "verification failed" }, { status: 401 });
    }
  } catch {
    return Response.json({ error: "invalid siwe message" }, { status: 400 });
  }

  // Bind the session to Arc testnet — blocks replay of a signature scoped to another chain.
  if (siwe.chainId !== arcTestnet.id) {
    return Response.json({ error: "wrong chain" }, { status: 401 });
  }

  if (!config.jwtSecret) {
    // JWT_SECRET not configured — auth cannot issue tokens. Return a clear error
    // so developers know to set JWT_SECRET in .env.local.
    return Response.json({ error: "JWT_SECRET not configured" }, { status: 503 });
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

  // `created` lets the client distinguish "account created" from "welcome back".
  return Response.json({ ok: true, address, role, created });
}

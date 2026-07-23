/**
 * The signed-in wallet's own sources — the data behind the /me/sources management page.
 *
 *   GET  /api/me/sources → { wallet, emailEnabled, sources: [...] } where each source carries
 *                          its notify state (alert email, webhook on/off) + earnings summary.
 *   POST /api/me/sources → { email } applies one alert email to EVERY source the wallet owns
 *                          (fresh unsubscribe token per source); empty string disables all.
 *
 * SIWE session only: this is a browser management surface, and merging a wallet's sources with
 * their private notify config in one response is exactly what the per-source owner gate protects —
 * so the whole route rides the same proof of wallet control. Scripts wanting the portfolio use
 * /api/creator/export; there is deliberately no API-key path here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sourcesOwnedBy } from "@/lib/sources/source-ownership";
import {
  emailNotifyConfigured,
  isValidAlertEmail,
  randomUnsubToken,
} from "@/lib/notify/citation-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwned() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb();
  // listAllSources, not listSources: a deactivated source still needs its alerts manageable —
  // retiring a feed shouldn't strand a subscribed email nobody can switch off from the UI.
  const owned = sourcesOwnedBy(await db.listAllSources(), session.address);
  return { db, owned, wallet: session.address };
}

export async function GET() {
  const ctx = await loadOwned();
  if ("error" in ctx) return ctx.error;
  const { db, owned, wallet } = ctx;

  // One grouped query for earnings, then per-source notify lookups (owner lists are small).
  const earningsBySource = new Map(
    (await db.creatorLeaderboard()).map((e) => [e.sourceId, e]),
  );
  const sources = await Promise.all(
    owned.map(async (s) => {
      const [emailNotify, webhook] = await Promise.all([
        db.getSourceNotifyEmail(s.id),
        db.getSourceNotify(s.id),
      ]);
      const earned = earningsBySource.get(s.id);
      return {
        id: s.id,
        name: s.name,
        active: s.active !== false,
        verified: s.verified !== false,
        earnedUsdc: earned?.totalEarnedUsdc ?? 0,
        citationCount: earned?.citationCount ?? 0,
        email: emailNotify?.email ?? null,
        webhookConfigured: Boolean(webhook?.url),
      };
    }),
  );

  return NextResponse.json({ wallet, emailEnabled: emailNotifyConfigured(), sources });
}

export async function POST(req: NextRequest) {
  const ctx = await loadOwned();
  if ("error" in ctx) return ctx.error;
  const { db, owned } = ctx;
  if (owned.length === 0) {
    return NextResponse.json({ error: "no sources owned by this wallet" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email && !isValidAlertEmail(email)) {
    return NextResponse.json({ error: "that doesn't look like an email address" }, { status: 400 });
  }

  // Same address for every source, but a FRESH token per source: unsubscribing one source's
  // alerts must not silently kill the others (each mail's link only clears its own row).
  for (const s of owned) {
    if (email) await db.setSourceNotifyEmail(s.id, email, randomUnsubToken());
    else await db.deleteSourceNotifyEmail(s.id);
  }

  return NextResponse.json({
    applied: email || null,
    sourceCount: owned.length,
    emailEnabled: emailNotifyConfigured(),
  });
}

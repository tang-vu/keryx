/**
 * Notify-on-citation settings for a single source — owner-only. Two independent channels:
 * a signed webhook (for the creator's software) and an email alert (for the creator).
 *
 *   GET  /api/creator/[id]/notify → { configured, url, email, emailEnabled } for the owner
 *                                    (webhook secret and unsubscribe token never returned)
 *   POST /api/creator/[id]/notify → body may carry `url` and/or `email`; each key present is
 *                                    applied on its own, so saving one channel can't clobber the
 *                                    other. Empty string disables that channel. Setting a webhook
 *                                    returns { secret } exactly once, like an API key.
 *
 * Ownership is enforced against the live SIWE session: the caller must be the source's payout
 * wallet or one of its author wallets. This lets an already-registered (e.g. seeded) creator add,
 * rotate, or disable either channel after the fact, not just at register time.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDeliverableUrl, randomNotifySecret } from "@/lib/notify/citation-webhook";
import {
  emailNotifyConfigured,
  isValidAlertEmail,
  randomUnsubToken,
} from "@/lib/notify/citation-email";
import { ownsSource } from "@/lib/sources/source-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwned(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return { error: NextResponse.json({ error: "source not found" }, { status: 404 }) };
  if (!ownsSource(source, session.address)) {
    return { error: NextResponse.json({ error: "not your source" }, { status: 403 }) };
  }
  return { db, source };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;
  const notify = await owned.db.getSourceNotify(id);
  const emailNotify = await owned.db.getSourceNotifyEmail(id);
  // Never echo the webhook secret or unsubscribe token on read — only owner-set values + state.
  return NextResponse.json({
    configured: Boolean(notify?.url),
    url: notify?.url ?? null,
    email: emailNotify?.email ?? null,
    // Whether THIS deployment can deliver mail — the panel shows "saved but dark" honestly.
    emailEnabled: emailNotifyConfigured(),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = "url" in body ? (typeof body.url === "string" ? body.url.trim() : "") : undefined;
  const email =
    "email" in body ? (typeof body.email === "string" ? body.email.trim() : "") : undefined;

  // Validate every provided channel BEFORE applying any — a 400 must mean nothing changed
  // (otherwise a bad email could discard the response carrying a just-rotated webhook secret).
  if (url && (url.length > 2048 || !isDeliverableUrl(url))) {
    return NextResponse.json(
      { error: "url must be an absolute http(s) URL under 2048 chars" },
      { status: 400 },
    );
  }
  if (email && !isValidAlertEmail(email)) {
    return NextResponse.json({ error: "that doesn't look like an email address" }, { status: 400 });
  }

  // Webhook channel — only when the caller sent a `url` key, so email-only saves can't delete it.
  let secret: string | undefined;
  if (url !== undefined) {
    if (!url) {
      await owned.db.deleteSourceNotify(id);
    } else {
      secret = randomNotifySecret();
      await owned.db.setSourceNotify(id, url, secret);
    }
  }

  // Email channel — independent of the webhook, same empty-string-disables contract.
  if (email !== undefined) {
    if (!email) await owned.db.deleteSourceNotifyEmail(id);
    else await owned.db.setSourceNotifyEmail(id, email, randomUnsubToken());
  }

  const notify = await owned.db.getSourceNotify(id);
  const emailNotify = await owned.db.getSourceNotifyEmail(id);
  return NextResponse.json({
    configured: Boolean(notify?.url),
    url: notify?.url ?? null,
    email: emailNotify?.email ?? null,
    emailEnabled: emailNotifyConfigured(),
    // Webhook signing secret — present only on the response that just rotated it.
    ...(secret ? { secret } : {}),
  });
}

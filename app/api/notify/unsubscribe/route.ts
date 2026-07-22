/**
 * One-click unsubscribe for citation email alerts.
 *
 *   GET /api/notify/unsubscribe?sid=<sourceId>&t=<token>
 *
 * Unauthenticated by design: the recipient of a mail must always be able to stop delivery,
 * whether or not they can SIWE-sign as the source owner (the address may be a colleague's).
 * Authorization is the per-row random token embedded in every mail — compared constant-time,
 * single-purpose, and useless for anything but disabling this one source's alerts.
 * Deliberately idempotent + uniform: a stale or wrong link gets the same calm page, so the
 * endpoint can't be used to probe which source ids have alerts configured.
 */

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function page(body: string): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Keryx — email alerts</title>
<meta name="robots" content="noindex"></head>
<body style="margin:0;padding:48px 24px;background:#faf6ec;color:#211d16;font-family:Georgia,'Times New Roman',serif;">
<div style="max-width:520px;margin:0 auto;border:1px solid #d8cfb8;padding:32px 28px;">
<p style="margin:0 0 6px;font-family:monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8c2f24;">Keryx</p>
${body}
<p style="margin:20px 0 0;font-size:13px;"><a href="/" style="color:#8c2f24;">keryx.cc</a></p>
</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";

  if (sid && token) {
    try {
      const db = await getDb();
      const notify = await db.getSourceNotifyEmail(sid);
      if (notify && tokensMatch(notify.unsubToken, token)) {
        await db.deleteSourceNotifyEmail(sid);
      }
    } catch {
      // Fall through to the uniform page — the link is retryable.
    }
  }

  // Same page whether the row existed, was already gone, or the link was wrong: the outcome the
  // recipient cares about ("no more mail from this link's source") holds in every branch.
  return page(
    `<h1 style="margin:0 0 12px;font-size:20px;font-weight:600;">Email alerts stopped</h1>
<p style="margin:0;font-size:14px;line-height:1.6;">If this source had citation email alerts, they're off now.
Every payout still shows on the source's public earnings page, and the owner can re-enable alerts
from there any time.</p>`,
  );
}

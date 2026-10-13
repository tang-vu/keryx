import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ownsSource } from "@/lib/sources/source-ownership";
import { presentationLanguage } from "@/lib/research/presentation-language";
import { readRecipientLanguage, writeRecipientLanguage } from "@/lib/notify/recipient-language";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownedRecipient(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb(), source = await db.getSource(id);
  if (!source) return { error: NextResponse.json({ error: "source not found" }, { status: 404 }) };
  if (!ownsSource(source, session.address)) return { error: NextResponse.json({ error: "not your source" }, { status: 403 }) };
  const notify = await db.getSourceNotifyEmail(id);
  if (!notify) return { error: NextResponse.json({ error: "email notification not configured" }, { status: 409 }) };
  return { db, recipient: { sourceId: id, email: notify.email, unsubToken: notify.unsubToken } };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owned = await ownedRecipient((await ctx.params).id);
  if (owned.error) return owned.error;
  return NextResponse.json(await readRecipientLanguage(owned.db, owned.recipient));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owned = await ownedRecipient((await ctx.params).id);
  if (owned.error) return owned.error;
  const body: unknown = await req.json().catch(() => null);
  const language = body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).length === 1 && "language" in body ? presentationLanguage(body.language) : undefined;
  if (!language) return NextResponse.json({ error: "invalid_language" }, { status: 400 });
  if (!await writeRecipientLanguage(owned.db, owned.recipient, language))
    return NextResponse.json({ error: "language_preference_unavailable" }, { status: 503 });
  const current = await owned.db.getSourceNotifyEmail(owned.recipient.sourceId);
  if (!current || current.email !== owned.recipient.email || current.unsubToken !== owned.recipient.unsubToken)
    return NextResponse.json({ error: "notification_recipient_changed" }, { status: 409 });
  return NextResponse.json({ language, available: true });
}

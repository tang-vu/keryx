import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { sourceItemContentVersion } from "@/lib/sources/source-item-asset";
import { signedPaperDeclarationSchema } from "@/lib/scholarly/rights-protocol";
import { readBoundedRequestJson } from "@/lib/read-bounded-request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function owner(id: string) {
  const session = await getSession();
  if (!session) return { response: Response.json({ error: "Sign in with your creator wallet" }, { status: 401 }) };
  const db = await getDb();
  if (!db.getPaperState || !db.submitPaper) return { response: Response.json({ error: "Scholarly pilot requires the supported SQLite datastore" }, { status: 503 }) };
  const source = await db.getSource(id);
  if (!source) return { response: Response.json({ error: "Source not found" }, { status: 404 }) };
  const terms = await sourceFetchTerms(source, { refresh: true });
  if (terms.authority !== "onchain" || terms.stale || !source.onchainId)
    return { response: Response.json({ error: "Fresh registered creator authority is required" }, { status: 503 }) };
  if (terms.creator.toLowerCase() !== session.address.toLowerCase())
    return { response: Response.json({ error: "Only the registry creator may submit distribution rights" }, { status: 403 }) };
  return { db, source, session, terms };
}
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const loaded = await owner((await ctx.params).id);
  if ("response" in loaded) return loaded.response!;
  const { db, source, terms } = loaded;
  const state = await db.getPaperState!(source.id), items = await db.getItems(source.id), item = items[0];
  const ready = items.length === 1 && item?.deliveryKind === "full_text" && !!item.manifest;
  return Response.json({ state, enrolled: source.scholarlyEnrolled === true, ready, items: items.length, active: source.active !== false && terms.active, verified: source.verified === true,
    binding: ready ? {
      protocol: "keryx-scholarly-rights-v1", network: "eip155:5042002", deploymentOrigin: new URL(config.baseUrl).origin,
      sourceId: source.id, itemId: item.id, registry: config.registryReadAddress, onchainId: source.onchainId,
      creator: terms.creator, recipient: terms.payTo, priceMicros: String(Math.round(terms.listPriceUsdc * 1e6)),
      canonicalUrl: item.link, contentVersion: sourceItemContentVersion(item), bodyHash: item.manifest!.bodyHash,
      plaintextBytes: item.manifest!.plaintextBytes, manifestId: item.manifest!.id,
    } : null }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PUT(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const loaded = await owner((await ctx.params).id);
  if ("response" in loaded) return loaded.response!;
  if (!loaded.db.beginPaperEnrollment) return Response.json({ error: "Scholarly enrollment backend unavailable" }, { status: 503 });
  try {
    await loaded.db.beginPaperEnrollment(loaded.source.id, loaded.session.address);
    return Response.json({ enrolled: true, status: "draft", earning: false });
  } catch { return Response.json({ error: "Pilot enrollment unavailable; supported datastore and fresh creator authority are required" }, { status: 409 }); }
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const loaded = await owner((await ctx.params).id);
  if ("response" in loaded) return loaded.response!;
  const { db, source, session } = loaded;
  const limit = await db.consumeRateLimit(`scholarly-submit:${session.address.toLowerCase()}`, 20, 3600_000, Date.now());
  if (!limit.allowed) return Response.json({ error: "Scholarly submission limit reached" }, { status: 429 });
  try {
    const parsed = signedPaperDeclarationSchema.parse(await readBoundedRequestJson(req, 16_384));
    if (parsed.declaration.sourceId !== source.id || parsed.declaration.creator !== session.address.toLowerCase())
      return Response.json({ error: "Declaration must match this authenticated creator and source" }, { status: 403 });
    const state = await db.submitPaper!(parsed);
    return Response.json({ state }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Rights signature, version, single-recipient registry terms, or permission fields are invalid" }, { status: 400 });
  }
}

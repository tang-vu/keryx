/**
 * GET  /api/sources           → list registered sources (public fields only)
 * POST /api/sources           → register a source. One-click via { rssUrl }, or full manual body.
 *   body: { rssUrl?, name?, url?, description?, fetchPrice?, walletAddress?, tags?, authors? }
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { createSource, type CreateSourceInput } from "@/lib/sources/create-source";
import { ingestRss } from "@/lib/ingest/rss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const sources = await db.listSources();
  return Response.json({
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      description: s.description,
      tags: s.tags,
      fetchPrice: s.fetchPrice,
      walletAddress: s.walletAddress,
      authors: s.authors.map((a) => ({ name: a.name, splitWeight: a.splitWeight })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = await getDb();

  let input: CreateSourceInput;
  try {
    if (typeof body.rssUrl === "string" && body.rssUrl.trim()) {
      const feed = await ingestRss(body.rssUrl.trim());
      input = {
        name: (body.name as string) || feed.feedTitle,
        url: (body.url as string) || feed.link,
        description: (body.description as string) || feed.feedDescription || feed.feedTitle,
        rssUrl: body.rssUrl.trim(),
        tags: (body.tags as string[]) ?? [],
        fetchPrice: body.fetchPrice ? Number(body.fetchPrice) : undefined,
        walletAddress: (body.walletAddress as string) || undefined,
        authors: (body.authors as CreateSourceInput["authors"]) || undefined,
        items: feed.items,
      };
    } else if (typeof body.name === "string" && typeof body.description === "string") {
      input = {
        name: body.name,
        url: (body.url as string) ?? "",
        description: body.description,
        tags: (body.tags as string[]) ?? [],
        fetchPrice: body.fetchPrice ? Number(body.fetchPrice) : undefined,
        walletAddress: (body.walletAddress as string) || undefined,
        authors: (body.authors as CreateSourceInput["authors"]) || undefined,
        items: (body.items as CreateSourceInput["items"]) || [],
      };
    } else {
      return Response.json(
        { error: "provide rssUrl, or name + description" },
        { status: 400 },
      );
    }
  } catch (err) {
    return Response.json(
      { error: "ingest failed", message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const source = await createSource(db, input);
  return Response.json({
    source: {
      id: source.id,
      name: source.name,
      walletAddress: source.walletAddress,
      fetchPrice: source.fetchPrice,
      authors: source.authors.map((a) => ({ name: a.name, splitWeight: a.splitWeight })),
    },
  });
}

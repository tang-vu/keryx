import { NextRequest } from "next/server";
import type { Hex } from "viem";

import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import {
  articleContentManifestId,
  validateArticleContentManifest,
} from "@/lib/sources/article-content-manifest";
import { contentBodyHash, contentBytes } from "@/lib/sources/content-receipt";
import { sourceItemIdentity } from "@/lib/sources/source-item-asset";
import { storeSourceItem } from "@/lib/sources/store-source-item";
import type { ArticleContentManifest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadContentOwner(id: string) {
  const session = await getSession();
  if (!session) return { response: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return { response: Response.json({ error: "source not found" }, { status: 404 }) };
  const terms = await sourceFetchTerms(source, { refresh: true });
  if (source.onchainId && (terms.authority !== "onchain" || terms.stale)) {
    return {
      response: Response.json(
        { error: "registry unavailable; content authority cannot be verified" },
        { status: 503 },
      ),
    };
  }
  if (session.address.toLowerCase() !== terms.creator.toLowerCase()) {
    return { response: Response.json({ error: "only the source creator can publish full text" }, { status: 403 }) };
  }
  return { db, source, terms, session };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await loadContentOwner(id);
  if ("response" in owned) return owned.response;
  const items = await owned.db.getItems(owned.source.id);
  return Response.json({
    sourceId: owned.source.id,
    sourceName: owned.source.name,
    creator: owned.terms.creator,
    active: owned.terms.active && owned.source.active !== false,
    verified: owned.source.verified !== false,
    items: items.slice(0, 20).map((item) => sourceItemIdentity(item)),
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const owned = await loadContentOwner(id);
  if ("response" in owned) return owned.response;
  const { db, source, terms, session } = owned;
  if (!terms.active || source.active === false || source.verified === false) {
    return Response.json({ error: "source must be active and verified" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const plaintext = typeof body.content === "string" ? body.content : "";
  const item = itemId ? await db.getItem(source.id, itemId) : null;
  if (!item) return Response.json({ error: "article not found" }, { status: 404 });

  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const bodyHash = typeof body.bodyHash === "string" ? body.bodyHash : "";
  const plaintextBytes = Number(body.plaintextBytes);
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(nonce) ||
    !/^0x[0-9a-fA-F]{64}$/.test(bodyHash) ||
    !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature) ||
    !Number.isSafeInteger(plaintextBytes)
  ) {
    return Response.json({ error: "invalid content manifest fields" }, { status: 400 });
  }
  if (contentBodyHash(plaintext) !== bodyHash || contentBytes(plaintext) !== plaintextBytes) {
    return Response.json({ error: "article body changed before submission" }, { status: 400 });
  }

  const manifest: ArticleContentManifest = {
    id: articleContentManifestId(signature as Hex),
    sourceId: source.id,
    itemId: item.id,
    canonicalUrl: item.link,
    bodyHash,
    plaintextBytes,
    deliveryKind: "full_text",
    signer: session.address,
    nonce,
    signature,
    createdAt: new Date().toISOString(),
  };
  const validity = await validateArticleContentManifest({
    manifest,
    item,
    plaintext,
    expectedSigner: terms.creator,
  });
  if (!validity.valid) return Response.json({ error: validity.reason }, { status: 400 });

  try {
    const stored = await storeSourceItem(
      { ...item, content: plaintext, deliveryKind: "full_text", manifest },
      { requireEncrypted: true },
    );
    // The legacy bundle endpoint caches by source id rather than article version. Clear it before
    // publishing this revision so no later paid bundle can serve the previous body.
    await db.setCached(source.id, "");
    await db.addItems([stored]);
    return Response.json(
      { item: sourceItemIdentity(stored), manifest: stored.manifest },
      { status: 201 },
    );
  } catch (error) {
    console.error(
      "[content] publisher upload failed",
      error instanceof Error ? error.message : String(error),
    );
    return Response.json(
      { error: "encrypted content storage is temporarily unavailable" },
      { status: 503 },
    );
  }
}

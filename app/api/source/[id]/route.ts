import { isPublicReferenceId } from "@/lib/public-references/catalog";
import { paperPaidGate } from "@/lib/scholarly/paid-gate";
/**
 * x402-protected creator content. Paying the toll (payTo = creator wallet) unlocks the full text.
 * GET /api/source/[id]
 *
 * Decryption path (when IPFS active):
 *   - Item has ipfsCid + itemKeyEnc + itemIv + itemAuthTag
 *   - Fetch ciphertext from IPFS gateway, unwrap key with CONTENT_MASTER_KEY, AES-GCM decrypt
 *   - Decrypted text cached via setCached so repeat reads skip the IPFS round-trip
 *   - Positive-price decryption is gated by settlement; zero-price delivery separately rechecks authority
 *
 * Fallback (offline dev or item predates IPFS):
 *   - Item has no ipfsCid → return plaintext content from DB (current behavior, unchanged)
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSourceItemContent, resolveFreeSourceItemContent } from "@/lib/sources/resolve-source-item-content";
import { sourceClaimAccess } from "@/lib/sources/source-claim-access";
import { assertSourceClaimRequest, sourceClaimPath } from "@/lib/sources/source-claim-request";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { settleThenServe } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (isPublicReferenceId(id)) return Response.json({ error: "Public references are free and have no payout authority" }, { status: 410 });
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) {
    return Response.json({ error: "source not found" }, { status: 404 });
  }
  const terms = await sourceFetchTerms(source, { refresh: true });
  const rightsDenied = await paperPaidGate(db, source, req, { kind: "fetch", payee: terms.payTo,
    amountMicros: Math.round(terms.listPriceUsdc * 1e6), bundle: true });
  if (rightsDenied) return rightsDenied;
  if (!terms.active || source.active === false || source.verified === false) {
    return Response.json({ error: "source is not active on the earning rail" }, { status: 410 });
  }
  let claimAccess;
  try { claimAccess = await sourceClaimAccess(db, source, terms); }
  catch { return Response.json({ error: "Current source claim authority is unavailable" }, { status: 503 }); }
  if (!claimAccess.readAllowed) return Response.json({ error: "This creator has not enabled access at the current price" }, { status: 410 });
  if (terms.listPriceUsdc > 0 || req.nextUrl.searchParams.has("claimId") || req.nextUrl.searchParams.has("claimRevision")) {
    try { assertSourceClaimRequest(req.nextUrl.searchParams, claimAccess.snapshot); }
    catch { return Response.json({ error: "Source policy changed; rediscover before paying" }, { status: 409 }); }
  }
  if (terms.listPriceUsdc === 0) {
    try {
      const items = await db.getItems(id);
      if (items.length > 5) return Response.json({ error: "Free bundles are limited to five articles; use version-bound article reads" }, { status: 413 });
      const resolved: { title: string; text: string }[] = [];
      let bytes = 0;
      for (const item of items) {
        const text = await resolveFreeSourceItemContent(db, source, item, claimAccess.snapshot ?? null);
        bytes += Buffer.byteLength(text, "utf8");
        if (bytes > 1_048_576) return Response.json({ error: "Free bundle exceeds 1 MiB; use version-bound article reads" }, { status: 413 });
        resolved.push({ title: item.title, text });
      }
      return Response.json({ content: resolved.map(item => `## ${item.title}\n${item.text}`).join("\n\n") || source.description,
        name: source.name, items: items.length, access: "creator-free", priceUsdc: 0,
        creatorRewardsEnabled: claimAccess.rewardAllowed, ...(claimAccess.snapshot ? { sourceClaim: claimAccess.snapshot } : {}) },
        { headers: { "Cache-Control": "no-store" } });
    } catch { return Response.json({ error: "The exact free content is unavailable" }, { status: 503 }); }
  }

  return settleThenServe(
    req,
    {
      priceUsdc: terms.listPriceUsdc,
      payTo: terms.payTo,
      endpoint: sourceClaimPath(`/api/source/${id}`, claimAccess.snapshot),
      resourceSourceId: id,
      resourceKind: "fetch",
      ...(claimAccess.snapshot ? { sourceClaim: { sourceId: id, receipt: claimAccess.snapshot, kind: "fetch" as const } } : {}),
      description: `${source.name} — full content`,
    },
    async (settle) => {
      const items = await db.getItems(id);

      // Check cache for already-decrypted content (avoids repeat IPFS fetch + decrypt).
      const cached = await db.getCached(id);
      if (cached) {
        return { content: cached, name: source.name, items: items.length, evidenceProvenance: source.evidenceProvenance ?? (items.some(item => item.evidenceProvenance === "synthetic-demo") ? "synthetic-demo" : undefined) };
      }

      const resolved = await Promise.all(
        items.map(async (item) => ({
          title: item.title,
          text: await resolveSourceItemContent(item, settle, {
            allowSummaryFallback: true,
            expectedManifestSigner: terms.creator,
          }),
        })),
      );

      const content =
        resolved.map((i) => `## ${i.title}\n${i.text}`).join("\n\n") ||
        source.description;

      // Cache the decrypted content so subsequent reads skip IPFS fetch.
      await db.setCached(id, content);

      return { content, name: source.name, items: items.length, evidenceProvenance: source.evidenceProvenance ?? (items.some(item => item.evidenceProvenance === "synthetic-demo") ? "synthetic-demo" : undefined) };
    },
  );
}

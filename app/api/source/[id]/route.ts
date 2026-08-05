/**
 * x402-protected creator content. Paying the toll (payTo = creator wallet) unlocks the full text.
 * GET /api/source/[id]
 *
 * Decryption path (when IPFS active):
 *   - Item has ipfsCid + itemKeyEnc + itemIv + itemAuthTag
 *   - Fetch ciphertext from IPFS gateway, unwrap key with CONTENT_MASTER_KEY, AES-GCM decrypt
 *   - Decrypted text cached via setCached so repeat reads skip the IPFS round-trip
 *   - Decryption is only reachable inside produce() — structurally gated by settlement
 *
 * Fallback (offline dev or item predates IPFS):
 *   - Item has no ipfsCid → return plaintext content from DB (current behavior, unchanged)
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { resolveSourceItemContent } from "@/lib/sources/resolve-source-item-content";
import { sourceFetchPayTo } from "@/lib/registry/source-fetch-payto";
import { settleThenServe } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) {
    return Response.json({ error: "source not found" }, { status: 404 });
  }
  const payTo = await sourceFetchPayTo(source);

  return settleThenServe(
    req,
    {
      priceUsdc: source.fetchPrice,
      payTo,
      endpoint: `/api/source/${id}`,
      description: `${source.name} — full content`,
    },
    async (settle) => {
      const items = await db.getItems(id);

      // Check cache for already-decrypted content (avoids repeat IPFS fetch + decrypt).
      const cached = await db.getCached(id);
      if (cached) {
        return { content: cached, name: source.name, items: items.length };
      }

      const resolved = await Promise.all(
        items.map(async (item) => ({
          title: item.title,
          text: await resolveSourceItemContent(item, settle, { allowSummaryFallback: true }),
        })),
      );

      const content =
        resolved.map((i) => `## ${i.title}\n${i.text}`).join("\n\n") ||
        source.description;

      // Cache the decrypted content so subsequent reads skip IPFS fetch.
      await db.setCached(id, content);

      return { content, name: source.name, items: items.length };
    },
  );
}

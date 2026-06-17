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
import { settleThenServe } from "@/lib/x402-server";
import { fetchByCid, hasPinata } from "@/lib/ipfs/pinata-client";
import { decryptContent, hasContentKey } from "@/lib/ipfs/content-crypto";
import type { SourceItem } from "@/lib/types";

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

  return settleThenServe(
    req,
    {
      priceUsdc: source.fetchPrice,
      payTo: source.walletAddress,
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

      const ipfsEnabled = hasPinata() && hasContentKey();
      const resolved = await Promise.all(items.map((item) => resolveItem(item, ipfsEnabled, settle)));

      const content =
        resolved.map((i) => `## ${i.title}\n${i.text}`).join("\n\n") ||
        source.description;

      // Cache the decrypted content so subsequent reads skip IPFS fetch.
      await db.setCached(id, content);

      return { content, name: source.name, items: items.length };
    },
  );
}

/** Resolve a single item's full text: decrypt from IPFS or fall back to DB plaintext. */
async function resolveItem(
  item: SourceItem,
  ipfsEnabled: boolean,
  settle: { payer: string; transaction: string },
): Promise<{ title: string; text: string }> {
  const title = item.title;

  // IPFS path: item was encrypted and pinned at ingest time.
  if (ipfsEnabled && item.ipfsCid && item.itemKeyEnc && item.itemIv && item.itemAuthTag) {
    try {
      const cipherBuf = await fetchByCid(item.ipfsCid);
      const plaintext = decryptContent(
        cipherBuf.toString("base64"),
        item.itemKeyEnc,
        item.itemIv,
        item.itemAuthTag,
      );
      // Log key release for auditability — payer + tx, never log plaintext or key material.
      console.log(`[ipfs] decrypted item ${item.id} for payer ${settle.payer} tx ${settle.transaction}`);
      return { title, text: plaintext };
    } catch (err) {
      // Decrypt failure (corrupted CID, gateway error, key mismatch) — serve summary fallback.
      // This is an ops issue; the payment already settled so we must return something.
      console.error(`[ipfs] decrypt failed for item ${item.id}:`, err);
      return { title, text: item.summary || "[content unavailable — decryption error]" };
    }
  }

  // Fallback: plaintext from DB (offline dev or pre-IPFS items).
  return { title, text: item.content || item.summary };
}

/**
 * GET /api/dispatch/[id]/receipt — public portable research receipt.
 *
 * This is a read-only projection over an archived dispatch and its durable payment rows. It never
 * decrypts paid content, invokes Gateway, reserves session capacity, or changes settlement state.
 */

import { getDb } from "@/lib/db";
import { buildResearchReceipt } from "@/lib/research-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });

  try {
    const db = await getDb();
    const run = await db.getQueryRun(id);
    if (!run) return Response.json({ error: "not found" }, { status: 404 });

    const payments = await db.listPaymentsByQuery(id);
    const receipt = buildResearchReceipt(run, payments);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Keryx-Receipt-Digest": receipt.integrity.digest,
    });
    if (new URL(request.url).searchParams.get("download") === "1") {
      const safeId = id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80) || "dispatch";
      headers.set("Content-Disposition", `attachment; filename="keryx-receipt-${safeId}.json"`);
    }
    return Response.json(receipt, { headers });
  } catch {
    return Response.json(
      { error: "receipt unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/**
 * GET /api/dispatch/[id]/receipt — public portable research receipt.
 *
 * This is a read-only projection over an archived dispatch and its durable payment rows. It never
 * decrypts paid content, invokes Gateway, reserves session capacity, or changes settlement state.
 */

import { getDb } from "@/lib/db";
import { buildResearchReceipt } from "@/lib/research-receipt";
import { quoteFromA2aOrder } from "@/lib/a2a/result";
import { historicalDispatchHeaders, resolveDispatch } from "@/lib/history/read-dispatch";

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
    const dispatch = await resolveDispatch(id, db);
    if (!dispatch) return Response.json({ error: "not found" }, { status: 404 });
    const { run, reader, archive } = dispatch;

    const payments = await reader.listCreatorPaymentAttemptsByQuery(id);
    // The archive restores public dispatch evidence, not live order/funding authority.
    const order = !archive && id.startsWith("a2a_") ? await db.getA2aOrder(id) : null;
    const receipt = buildResearchReceipt(run, payments, order ? quoteFromA2aOrder(order).funding : undefined);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Keryx-Receipt-Digest": receipt.integrity.digest,
      ...historicalDispatchHeaders(archive),
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

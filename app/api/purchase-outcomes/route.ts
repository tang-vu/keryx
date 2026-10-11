import { purchaseAggregateResponse } from "@/lib/research/purchase-outcome-aggregate-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/purchase-outcomes — pooled recorded purchase outcomes by cohort. Public, read-only. */
export async function GET(request: Request) {
  return purchaseAggregateResponse(request);
}

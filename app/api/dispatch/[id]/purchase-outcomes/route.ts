import { purchaseOutcomesResponse } from "@/lib/research/purchase-outcomes-http";
import { readPublicPurchaseOutcomes } from "@/lib/research/purchase-outcomes-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return purchaseOutcomesResponse(request, id, readPublicPurchaseOutcomes);
}

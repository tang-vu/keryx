import { purchaseOutcomeId, validatePurchaseOutcomes } from "./purchase-outcomes-contract";

export async function purchaseOutcomesResponse(request: Request, id: string,
  read: (id: string) => Promise<unknown | null>): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  const json = (value: unknown, status: number) => new Response(JSON.stringify(value), { status, headers });
  const params = new URL(request.url).searchParams;
  if (!purchaseOutcomeId.safeParse(id).success || [...params.keys()].some(key => key !== "download")
    || params.getAll("download").length > 1 || params.has("download") && params.get("download") !== "1")
    return json({ error: "Invalid purchase-outcome request" }, 400);
  try {
    const value = await read(id);
    if (value === null) return json({ error: "Public dispatch not found" }, 404);
    const report = validatePurchaseOutcomes(value, id);
    return new Response(JSON.stringify(report), { headers: { ...headers,
      ...(params.has("download") ? { "Content-Disposition": `attachment; filename="keryx-purchase-outcomes-${id}.json"` } : {}) } });
  } catch {
    return json({ error: "Recorded purchase outcomes unavailable" }, 503);
  }
}

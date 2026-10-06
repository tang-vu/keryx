import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { readOperatorStatus } from "@/lib/business-operator/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await readOperatorStatus(await getDb(), config.networkId),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Operator observation unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

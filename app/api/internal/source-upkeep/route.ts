import { getDb } from "@/lib/db";
import { handleSourceUpkeep } from "@/lib/ingest/source-upkeep";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleSourceUpkeep(request, process.env.KERYX_SOURCE_UPKEEP_TOKEN, getDb);
}

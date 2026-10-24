import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createRequesterFeedbackRoute } from "@/lib/research-feedback/http";
import { configuredRequesterOpinionStore } from "@/lib/research-feedback/metadata-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(clientIp(req), "public");
  if (blocked) { blocked.headers.set("Cache-Control", "private, no-store"); blocked.headers.set("Vary", "Authorization"); return blocked; }
  const binding = { network: config.networkId, origin: config.baseUrl };
  return createRequesterFeedbackRoute({ db: getDb, store: () => configuredRequesterOpinionStore(binding), binding,
    secret: () => config.jwtSecret })(req);
}

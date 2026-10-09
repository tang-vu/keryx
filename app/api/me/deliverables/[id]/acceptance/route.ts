import { accountSessionContext } from "@/lib/account-sessions";
import { verifyApiKey } from "@/lib/api-keys";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { createAcceptanceRoute } from "@/lib/deliverable-acceptance/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dependencies = { session: accountSessionContext, key: verifyApiKey, db: getDb, network: config.networkId, baseUrl: config.baseUrl };
export const GET = createAcceptanceRoute(dependencies, false);
export const POST = createAcceptanceRoute(dependencies, true);

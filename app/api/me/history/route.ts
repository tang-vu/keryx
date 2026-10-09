import { accountSessionContext } from "@/lib/account-sessions";
import { verifyApiKey } from "@/lib/api-keys";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { createHistoryRoute } from "@/lib/history/personal-history-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createHistoryRoute({ session: accountSessionContext, key: verifyApiKey, db: getDb, network: config.networkId });

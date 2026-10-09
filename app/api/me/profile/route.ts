import { accountSessionContext } from "@/lib/account-sessions";
import { verifyApiKey } from "@/lib/api-keys";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { createProfileRoutes } from "@/lib/profiles/profile-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createProfileRoutes({ session: accountSessionContext, key: verifyApiKey, db: getDb, network: config.networkId });
export const GET = routes.GET;
export const PUT = routes.PUT;
export const DELETE = routes.DELETE;

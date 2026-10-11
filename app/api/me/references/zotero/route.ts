import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createZoteroRoutes } from "@/lib/references/zotero-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createZoteroRoutes(accountSessionContext, config.baseUrl, config.networkId, () => process.env.KERYX_ZOTERO_ENABLED === "1");
export const GET = routes.status;
export const PUT = routes.connect;
export const DELETE = routes.revoke;

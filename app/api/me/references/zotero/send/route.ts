import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createZoteroRoutes } from "@/lib/references/zotero-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createZoteroRoutes(accountSessionContext, config.baseUrl, config.networkId, () => process.env.KERYX_ZOTERO_ENABLED === "1").send;

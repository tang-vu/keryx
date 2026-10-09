import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createBibliographyManagement } from "@/lib/bibliographies/bibliography-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createBibliographyManagement(accountSessionContext, config.baseUrl);
export const GET = routes.list;
export const POST = routes.create;

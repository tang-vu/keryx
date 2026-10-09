import { accountSessionContext } from "@/lib/account-sessions";
import { createBibliographyManagement } from "@/lib/bibliographies/bibliography-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createBibliographyManagement(accountSessionContext);
export const GET = routes.list;
export const POST = routes.create;

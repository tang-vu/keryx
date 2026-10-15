import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createAssignmentRoutes } from "@/lib/owner-run-assignments/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createAssignmentRoutes(accountSessionContext, config.baseUrl);
export const GET = routes.GET;
export const POST = routes.POST;

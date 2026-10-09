import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createDecisionReviewRoutes } from "@/lib/research/decision-review-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createDecisionReviewRoutes(accountSessionContext, config.baseUrl);
export const GET = routes.GET;
export const POST = routes.POST;

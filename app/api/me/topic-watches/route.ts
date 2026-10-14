import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createTopicWatchManagement } from "@/lib/research/topic-watch-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createTopicWatchManagement(accountSessionContext, config.baseUrl);
export const GET = routes.list;
export const POST = routes.create;

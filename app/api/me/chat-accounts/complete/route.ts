import { config } from "@/lib/config";
import { accountSessionContext } from "@/lib/account-sessions";
import { createChatAccountRoutes } from "@/lib/chat-accounts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createChatAccountRoutes({ binding: { origin: new URL(config.baseUrl).origin, network: config.networkId }, session: accountSessionContext });
export const POST = routes.complete;

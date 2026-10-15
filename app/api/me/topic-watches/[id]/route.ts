import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createTopicWatchManagement } from "@/lib/research/topic-watch-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const routes = createTopicWatchManagement(accountSessionContext, config.baseUrl);
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, context: Context) { return routes.read(req, (await context.params).id); }
export async function PUT(req: Request, context: Context) { return routes.update(req, (await context.params).id); }
export async function POST(req: Request, context: Context) { return routes.action(req, (await context.params).id); }
export async function DELETE(req: Request, context: Context) { return routes.cancel(req, (await context.params).id); }

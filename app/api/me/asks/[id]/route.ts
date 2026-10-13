import { ownedHistoryHttp } from "@/lib/history/owned-history-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = async (request: Request, context: { params: Promise<{ id: string }> }) => ownedHistoryHttp("detail")(request, (await context.params).id);

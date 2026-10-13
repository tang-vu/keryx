import { ownedHistoryHttp } from "@/lib/history/owned-history-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => ownedHistoryHttp("export")(request);

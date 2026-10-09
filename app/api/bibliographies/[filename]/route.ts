import { getDb } from "@/lib/db";
import { createBibliographyDownload } from "@/lib/bibliographies/bibliography-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const download = createBibliographyDownload(getDb);
export async function GET(req: Request, context: { params: Promise<{ filename: string }> }) { return download(req, (await context.params).filename); }

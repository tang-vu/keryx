import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { usageWindow } from "@/lib/usage/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let window;
  try { window = usageWindow(new URL(request.url).searchParams, config.profile.networkId); }
  catch { return Response.json({ error: "invalid_usage_filter" }, { status: 400 }); }
  try {
    const db = await getDb();
    if (!db.publicUsage) throw new Error("usage_unavailable");
    return Response.json(await db.publicUsage.summary(window));
  } catch {
    return Response.json({ error: "usage_unavailable", window, complete: false, figures: null }, { status: 503 });
  }
}

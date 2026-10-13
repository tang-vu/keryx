import { getDb } from "@/lib/db";
import { publicArchiveRequest, publicArticlePreview } from "@/lib/public-references/archive-openapi";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let options;
  try { options = publicArchiveRequest(new URL(request.url)); }
  catch { return Response.json({ error: "Invalid article library request" }, { status: 400 }); }
  try {
    const db = await getDb();
    if (!db.queryPublicReferenceItems) throw new Error("Archive unavailable");
    const page = await db.queryPublicReferenceItems(options);
    return Response.json({ total: page.total, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      items: page.items.map(publicArticlePreview) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof Error && "code" in error && ["invalid-cursor", "invalid-query"].includes(String(error.code));
    return Response.json({ error: invalid ? "Invalid article library cursor" : "Article library unavailable" }, { status: invalid ? 400 : 503 });
  }
}

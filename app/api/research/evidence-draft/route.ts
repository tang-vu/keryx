import { getSession } from "@/lib/auth";
import { verifyApiKey } from "@/lib/api-keys";
import { hasScope, parseScopes } from "@/lib/api-key-scopes";
import { createEvidenceDraftRoute } from "@/lib/research/evidence-draft-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createEvidenceDraftRoute(async request => {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(authorization)) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const key = await verifyApiKey(authorization.slice(7));
    if (!key) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (!hasScope(parseScopes(key.scopes), "export")) return Response.json({ error: "insufficient_scope" }, { status: 403 });
    return null;
  }
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "same_origin_required" }, { status: 403 });
  return await getSession() ? null : Response.json({ error: "unauthenticated" }, { status: 401 });
});

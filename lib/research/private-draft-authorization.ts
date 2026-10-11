import { getSession } from "../auth";
import { verifyApiKey } from "../api-keys";
import { hasScope, parseScopes } from "../api-key-scopes";
import { isConfiguredSameOrigin } from "../auth-origin";
import { config } from "../config";

/** Shared by the private draft routes: an export-scoped API key, or an active web
 * session whose Origin is the configured public BASE_URL. Returns a denial, or null
 * when the caller may submit a private draft body. No body byte is read here. */
export async function authorizePrivateDraftRequest(request: Request): Promise<Response | null> {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(authorization)) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const key = await verifyApiKey(authorization.slice(7));
    if (!key) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (!hasScope(parseScopes(key.scopes), "export")) return Response.json({ error: "insufficient_scope" }, { status: 403 });
    return null;
  }
  if (!isConfiguredSameOrigin(request, config.baseUrl))
    return Response.json({ error: "same_origin_required" }, { status: 403 });
  return await getSession() ? null : Response.json({ error: "unauthenticated" }, { status: 401 });
}

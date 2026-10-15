import { accountSessionContext } from "../account-sessions";
import { verifyApiKey } from "../api-keys";
import { getDb } from "../db";
import { config } from "../config";
import { privateRunResponse } from "../run-claims/private-response";
import { createPrivateJobHistoryRoute } from "./private-job-history-route";

/** Mount the accepted factory with established auth/storage, never caller-selected adapters.
 * Origin is a CSRF fence before cookie authentication; it supplies no owner authority. */
export function createMountedPrivateJobHistoryRoute(action: "list" | "detail" | "export") {
  const handle = createPrivateJobHistoryRoute({ session: accountSessionContext, key: verifyApiKey, db: getDb }, action);
  let expectedOrigin: string | null = null;
  try {
    const url = new URL(config.baseUrl);
    if (url.protocol === "https:" || url.protocol === "http:") expectedOrigin = url.origin;
  } catch { /* Invalid trusted configuration refuses before auth/storage. */ }
  return async (req: Request): Promise<Response> => {
    // Delegate method refusals to the factory, including its private headers and Allow.
    if (req.method !== "POST") return handle(req);
    if (expectedOrigin === null) return privateRunResponse(Response.json({ error: "history_unavailable" }, { status: 503 }));
    const origin = req.headers.get("origin");
    if (origin === null ? !req.headers.has("authorization") : origin !== expectedOrigin) {
      return privateRunResponse(Response.json({ error: "invalid_origin" }, { status: 403 }));
    }
    // Bearer presence excludes cookie fallback in the unchanged factory. Its exact key/session
    // is checked again after private IO and serialization; no pre-auth DB lookup is added here.
    return handle(req);
  };
}

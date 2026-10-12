import { MAX_PROCUREMENT_BYTES } from "./contracts";
import { buildEvidenceProcurement } from "./engine";
import { readBoundedRequestJson } from "../read-bounded-request-json";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, Cookie",
  "X-Content-Type-Options": "nosniff",
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders });

/** Authenticate before touching private bytes. Transformation never resolves
 * URLs, invokes providers, stores the packet, or creates financial authority. */
export function createEvidenceProcurementRoute(authorize: (request: Request) => Promise<Response | null>) {
  return async (request: Request) => {
    try {
      if (new URL(request.url).search) return json({ error: "invalid_evidence_procurement_request" }, 400);
      const denied = await authorize(request);
      if (denied) {
        for (const [name, value] of Object.entries(privateHeaders)) denied.headers.set(name, value);
        return denied;
      }
    } catch { return json({ error: "procurement_authentication_unavailable" }, 503); }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
      return json({ error: "invalid_evidence_procurement_request" }, 400);
    try {
      return json({ procurement: await buildEvidenceProcurement(await readBoundedRequestJson(request, MAX_PROCUREMENT_BYTES)) });
    } catch { return json({ error: "invalid_evidence_procurement" }, 400); }
  };
}

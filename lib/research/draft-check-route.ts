import { readBoundedRequestJson } from "../read-bounded-request-json";
import { buildDraftCheck, MAX_DRAFT_CHECK_BYTES } from "./draft-check";

const headers = { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

/** Authentication precedes private body reading; fixed errors never echo the draft. */
export function createDraftCheckRoute(authorize: (request: Request) => Promise<Response | null>) {
  return async (request: Request) => {
    try {
      if (new URL(request.url).search) return json({ error: "invalid_draft_check_request" }, 400);
      const denied = await authorize(request);
      if (denied) {
        for (const [name, value] of Object.entries(headers)) denied.headers.set(name, value);
        return denied;
      }
    } catch { return json({ error: "draft_authentication_unavailable" }, 503); }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
      return json({ error: "invalid_draft_check_request" }, 400);
    try {
      return json({ check: buildDraftCheck(await readBoundedRequestJson(request, MAX_DRAFT_CHECK_BYTES)) });
    } catch { return json({ error: "invalid_draft_check" }, 400); }
  };
}

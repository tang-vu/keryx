import { readBoundedRequestJson } from "../read-bounded-request-json";
import { buildEvidenceDraft, MAX_EVIDENCE_DRAFT_BYTES } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";

const headers = { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

export function createEvidenceDraftRoute(authorize: (request: Request) => Promise<Response | null>) {
  return async (request: Request) => {
    try {
      if (new URL(request.url).search) return json({ error: "invalid_draft_request" }, 400);
      const denied = await authorize(request);
      if (denied) {
        for (const [name, value] of Object.entries(headers)) denied.headers.set(name, value);
        return denied;
      }
    } catch { return json({ error: "draft_authentication_unavailable" }, 503); }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
      return json({ error: "invalid_draft_request" }, 400);
    try {
      const input = await readBoundedRequestJson(request, MAX_EVIDENCE_DRAFT_BYTES);
      return json({ draft: buildEvidenceDraft(input), exports: exportEvidenceDraft(input) });
    } catch { return json({ error: "invalid_or_changed_draft" }, 400); }
  };
}

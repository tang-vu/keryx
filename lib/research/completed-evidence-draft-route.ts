import { isConfiguredSameOrigin } from "../auth-origin";
import { readBoundedRequestJson } from "../read-bounded-request-json";
import { CompletedReadRefusal, loadCompletedEvidenceDraft, type CompletedReadContext } from "./completed-evidence-draft";

const headers = { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie, Origin, X-Keryx-Expected-Owner",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (value: unknown, status: number) => Response.json(value, { status, headers });
export function createCompletedEvidenceDraftRoute(options: {
  baseUrl: string; network: string;
  account: () => Promise<Pick<CompletedReadContext, "db" | "wallet"> | Response>;
}) {
  // Capture trusted configured routing once; never select it from Host, forwards,
  // body data, an API key or an imported report.
  const { baseUrl, network, account } = options;
  return async (request: Request) => {
    try {
      if (request.method !== "POST" || new URL(request.url).search || new URL(request.url).hash)
        return json({ error: "invalid_completed_read_request" }, 400);
      if (request.headers.has("authorization")) return json({ error: "account_session_required" }, 401);
      if (!isConfiguredSameOrigin(request, baseUrl)) return json({ error: "same_origin_required" }, 403);
      const expectedOwner = request.headers.get("x-keryx-expected-owner");
      if (!expectedOwner || !/^0x[a-f0-9]{40}$/.test(expectedOwner) || /^0x0{40}$/.test(expectedOwner))
        return json({ error: "expected_owner_required" }, 403);
      const context = await account();
      if (context instanceof Response) return json({ error: context.status === 401 ? "account_session_required" : "completed_read_authentication_unavailable" }, context.status === 401 ? 401 : 503);
      if (context.wallet !== expectedOwner) return json({ error: "owner_changed" }, 403);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
        return json({ error: "invalid_completed_read_request" }, 400);
      let value: unknown;
      try { value = await readBoundedRequestJson(request, 65536); }
      catch { return json({ error: "invalid_completed_read_request" }, 400); }
      try {
        const packet = await loadCompletedEvidenceDraft({ ...context, baseUrl, network }, value);
        if (new TextEncoder().encode(JSON.stringify(packet)).length > 524288) throw new CompletedReadRefusal("changed");
        return json(packet, 200);
      }
      catch (error) { return json({ error: error instanceof CompletedReadRefusal && error.kind === "storage"
        ? "completed_read_storage_unavailable" : "completed_read_unavailable_or_changed" }, error instanceof CompletedReadRefusal && error.kind === "storage" ? 503 : 409); }
    } catch { return json({ error: "completed_read_authentication_unavailable" }, 503); }
  };
}

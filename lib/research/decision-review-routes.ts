import type { KeryxDB } from "../db/keryx-db";
import { isConfiguredSameOrigin } from "../auth-origin";
import { recordLiveReviewVerdict } from "./decision-review-live";
import { DecisionReviewError, reviewIdSchema, reviewOwner, reviewVerdictSchema, reviewWalletSchema } from "./decision-review-types";

const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie, X-Keryx-Expected-Wallet", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders });
export function createDecisionReviewRoutes(session: () => Promise<{ db: KeryxDB; wallet: string; currentId: string } | Response>, baseUrl: unknown) {
  async function execute(req: Request, write: boolean) {
    try {
      if (req.headers.has("authorization")) return json({ error: "session_required" }, 401);
      const expected = req.headers.get("x-keryx-expected-wallet")?.toLowerCase();
      if (!expected) return json({ error: "owner_precondition_required" }, 428);
      if (!reviewWalletSchema.safeParse(expected).success) return json({ error: "invalid_owner_precondition" }, 400);
      if (write && !isConfiguredSameOrigin(req, baseUrl)) return json({ error: "same_origin_required" }, 403);
      const context = await session();
      if (context instanceof Response) return new Response(context.body, { status: context.status, headers: privateHeaders });
      if (reviewOwner(context.wallet) !== expected) return json({ error: "review_owner_changed" }, 409);
      const store = context.db.decisionReviews;
      if (!store) throw new DecisionReviewError("review_unavailable");
      const url = new URL(req.url);
      if (!write) {
        if ([...url.searchParams.keys()].some(key => key !== "runId") || url.searchParams.getAll("runId").length !== 1) return json({ error: "invalid_review" }, 400);
        const runId = reviewIdSchema.safeParse(url.searchParams.get("runId"));
        if (!runId.success) return json({ error: "invalid_review" }, 400);
        const rows = await store.list(context.wallet, runId.data);
        const elapsed = rows.filter(row => ["held", "approved"].includes(row.state) && row.expiresAt && Date.parse(row.expiresAt) <= Date.now());
        // Explicit owner readback closes elapsed crash remnants; it cannot resume a run.
        await Promise.all(elapsed.map(row => store.expire(context.wallet, row.id)));
        return json({ reviews: elapsed.length ? await store.list(context.wallet, runId.data) : rows });
      }
      if (url.search || !req.body || !/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type") ?? "")) return json({ error: "invalid_review" }, 400);
      const reader = req.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined); }, 5000); });
      let input;
      try {
        for (;;) { const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
          size += value.length; if (size > 4096) throw new Error("Body limit"); chunks.push(value); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        input = reviewVerdictSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      } catch { return json({ error: "invalid_review" }, 400); }
      finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      return json({ review: await recordLiveReviewVerdict(store, context.wallet, input, context.currentId) });
    } catch (error) {
      const code = error instanceof DecisionReviewError ? error.code : "review_unavailable";
      return json({ error: code }, code === "review_not_found" ? 404 : ["review_conflict", "review_expired", "review_live_required"].includes(code) ? 409 : 503);
    }
  }
  return { GET: (req: Request) => execute(req, false), POST: (req: Request) => execute(req, true) };
}

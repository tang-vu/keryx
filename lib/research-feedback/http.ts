import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import type { RunClaimBinding } from "../run-claims/contracts";
import { FeedbackError, feedbackInputSchema, feedbackResponseSchema, type RequesterFeedbackStore } from "./contracts";
import { deliveredResearchDigest, requesterFeedbackId, verifyFeedbackToken } from "./service";

const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("read") }).strict(),
  feedbackInputSchema.extend({ operation: z.literal("submit") }).strict(),
]);
export function feedbackJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } });
}
async function readBody(req: Request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get("content-type") ?? "") || !req.body) throw new Error();
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    reject(new Error()); void reader.cancel().catch(() => {});
  }, 10000); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.length;
      if (total > 4096) throw new Error();
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return requestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function createRequesterFeedbackRoute(deps: { db(): Promise<Pick<KeryxDB, "getQueryRun">>; store(): RequesterFeedbackStore; binding: RunClaimBinding; secret(): string }) {
  return async (req: Request) => {
    try {
      const header = req.headers.get("authorization") ?? "";
      if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header) || header.length > 2055) return feedbackJson({ error: "feedback_unauthenticated" }, 401);
      const capability = verifyFeedbackToken(header.slice(7), deps.binding, deps.secret());
      let input;
      try { input = await readBody(req); } catch { return feedbackJson({ error: "invalid_feedback_input" }, 400); }
      const store = deps.store(); store.assertAvailable();
      if (store.storeId !== capability.storeId) throw new FeedbackError("feedback_unauthenticated");
      const db = await deps.db();
      const original = await db.getQueryRun(capability.runId);
      if (!original || original.planningFailure || deliveredResearchDigest(original) !== capability.deliveredDigest) throw new FeedbackError("feedback_conflict");
      const id = requesterFeedbackId(capability.runId, capability.deliveredDigest);
      const feedback = input.operation === "read" ? await store.read(id) : await store.submit({
        format: "keryx-requester-feedback-v1", runId: capability.runId, deliveredDigest: capability.deliveredDigest,
        choice: input.choice, reason: input.reason, submittedAt: new Date().toISOString(),
      });
      if (input.operation === "submit" && (!feedback || feedback.choice !== input.choice || feedback.reason !== input.reason)) throw new FeedbackError("feedback_conflict");
      return feedbackJson(feedbackResponseSchema.parse({ format: "keryx-requester-feedback-response-v1", runId: capability.runId,
        deliveredDigest: capability.deliveredDigest, feedback, execution: "none" }));
    } catch (error) {
      const code = error instanceof FeedbackError ? error.code : "feedback_unavailable";
      return feedbackJson({ error: code }, code === "feedback_unauthenticated" ? 401 : code === "feedback_conflict" ? 409 : 503);
    }
  };
}

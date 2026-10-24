import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { runClaimBindingSchema, type RunClaimBinding } from "../run-claims/contracts";
import { FeedbackError, feedbackDeliverySchema, feedbackRowSchema, jobObservationsSchema, type RequesterFeedbackStore, type FeedbackDelivery } from "./contracts";
import { recordedJobObservations } from "./observations";
import { demoteSyntheticEvidence } from "../research/evidence-provenance";

const TTL = 30 * 24 * 60 * 60 * 1000;
const purpose = "keryx-requester-feedback-capability-v1";
const capabilitySchema = z.object({ version: z.literal(1), storeId: z.string().uuid(), runId: feedbackRowSchema.shape.runId,
  deliveredDigest: feedbackRowSchema.shape.deliveredDigest, binding: runClaimBindingSchema,
  observations: jobObservationsSchema,
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() }).strict()
  .refine(value => value.expiresAt - value.issuedAt === TTL);
export function deliveredResearchDigest(run: QueryRun): string {
  run = demoteSyntheticEvidence(run);
  const original = JSON.stringify([run.id, run.question, run.answer,
    run.citations.map(row => [row.marker, row.sourceId, row.sourceName, row.itemUrl ?? null]), run.evidence ?? null]);
  if (Buffer.byteLength(original) > 2 * 1024 * 1024) throw new FeedbackError("feedback_unavailable");
  return createHash("sha256").update(original).digest("hex");
}
function key(secret: string) {
  if (secret.length < 32 || Buffer.byteLength(secret) < 32) throw new FeedbackError("feedback_unavailable");
  return Buffer.from(hkdfSync("sha256", secret, "Keryx caller observations", purpose, 32));
}
const signature = (body: string, secret: string) => createHmac("sha256", key(secret)).update(`${purpose}.${body}`).digest();
export function issueFeedbackToken(run: QueryRun, binding: RunClaimBinding, secret: string, storeId: string, now = Date.now(), observations = recordedJobObservations(run)) {
  const payload = capabilitySchema.parse({ version: 1, storeId, runId: run.id, binding, observations, deliveredDigest: deliveredResearchDigest(run), issuedAt: now, expiresAt: now + TTL });
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${signature(body, secret).toString("base64url")}`, expiresAt: new Date(payload.expiresAt).toISOString(), endpoint: "/api/research-feedback" as const };
}
export function verifyFeedbackToken(raw: string, binding: RunClaimBinding, secret: string, now = Date.now()) {
  try {
    if (raw.length > 2048) throw new Error();
    const parts = raw.split(".");
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const [body, encoded] = parts, supplied = Buffer.from(encoded, "base64url");
    const expected = signature(body, secret);
    if (supplied.toString("base64url") !== encoded || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
    const bytes = Buffer.from(body, "base64url");
    if (bytes.toString("base64url") !== body) throw new Error();
    const value = capabilitySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (value.binding.network !== binding.network || value.binding.origin !== binding.origin || value.issuedAt > now || value.expiresAt <= now) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof FeedbackError) throw error;
    throw new FeedbackError("feedback_unauthenticated");
  }
}
export function requesterFeedbackId(runId: string, digest: string) {
  const hex = createHash("sha256").update(`${purpose}\0${runId}\0${digest}`).digest("hex").slice(0, 32).split("");
  hex[12] = "8"; hex[16] = "89ab"[parseInt(hex[16], 16) % 4];
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
/** Invoke only after the trusted original persistence boundary. Never place the
 * packet in QueryRun, public meta, reports, receipts, exports or analytics.
 * A late optional failure preserves the saved answer and all payment state.
 */
export async function privateRequesterObservations(options: { run: QueryRun; db: Pick<KeryxDB, "getQueryRun">; store(): RequesterFeedbackStore; publicOriginal: boolean;
  binding: RunClaimBinding; secret: string; signal?: AbortSignal }): Promise<FeedbackDelivery | null> {
  const { run } = options;
  if (options.signal?.aborted || !options.publicOriginal || run.planningFailure || !feedbackRowSchema.shape.runId.safeParse(run.id).success || !run.answer.trim()) return null;
  let feedback: FeedbackDelivery["feedback"] = null;
  const observations = recordedJobObservations(run);
  try {
    const saved = await options.db.getQueryRun(run.id);
    if (!options.signal?.aborted && saved && deliveredResearchDigest(saved) === deliveredResearchDigest(run)) {
      const store = options.store(); store.assertAvailable();
      feedback = issueFeedbackToken(run, options.binding, options.secret, store.storeId, Date.now(), observations);
    }
  } catch { /* Optional, caller-private observation only. No retry of research. */ }
  try { return feedbackDeliverySchema.parse({ format: "keryx-private-requester-observation-v1", runId: run.id,
    observations, feedback }); } catch { return null; }
}

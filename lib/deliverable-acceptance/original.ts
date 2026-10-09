import { createHash } from "node:crypto";
import { z } from "zod";
import { exactA2aMicros } from "../a2a/amount-micros";
import { a2aOrderId, a2aRequestHash } from "../a2a/order";
import { isSupportedA2aResearchPackage } from "../a2a/research-package";
import { AcceptanceError, acceptanceEntrySchema, acceptanceSnapshotSchema, publicAcceptanceSchema,
  deliverableIdSchema, networkSchema, walletSchema, acceptanceMetricsSchema, type PublicAcceptance, type AcceptanceEntry, type AcceptanceSnapshot } from "./contracts";

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
/** Internal retained record, never accepted from HTTP/MCP input. Its exact text is CAS authority. */
export function originalBinding(storeId: string, originalText: string, owner: string, network: string, id: string) {
  try {
    z.string().uuid().parse(storeId); walletSchema.parse(owner); networkSchema.parse(network); deliverableIdSchema.parse(id);
    if (typeof originalText !== "string" || Buffer.byteLength(originalText) > 4_194_304) throw new Error("Bound");
    const raw = z.object({ order: z.record(z.string(), z.unknown()), deliveryText: z.string().min(2).max(4_000_000),
      settled: z.literal(true), network: networkSchema }).strict().parse(JSON.parse(originalText));
    const row = raw.order, request = json(row.request_data), pkg = json(row.package_data);
    const response = json(raw.deliveryText);
    if (!request || typeof request !== "object" || Array.isArray(request) || request.monthlyId !== undefined ||
      request.network !== network || raw.network !== network || row.id !== id || row.query_id !== id ||
      typeof row.payer !== "string" || row.payer.toLowerCase() !== owner || typeof row.payee !== "string" ||
      !walletSchema.safeParse(row.payee.toLowerCase()).success || typeof row.authorization_id !== "string" ||
      !/^0x[a-f0-9]{64}$/.test(row.authorization_id) || row.status !== "completed" ||
      typeof row.transaction_id !== "string" || !row.transaction_id.trim() || row.transaction_id.length > 512 ||
      (request.origin !== "a2a" && request.origin !== "engine") || typeof request.question !== "string" ||
      !request.question.trim() || request.question.length > 10_000 ||
      (request.model !== undefined && (typeof request.model !== "string" || request.model.length > 256)) ||
      (row.research_mode !== "quick" && row.research_mode !== "deep") ||
      !isSupportedA2aResearchPackage(pkg, row.research_mode) || pkg.serviceLevel.remedy !== "none" ||
      !response || response.status !== "completed" || response.queryId !== id || typeof response.answer !== "string" ||
      !response.answer.trim() || response.answer.length > 1_000_000 ||
      a2aOrderId({ network, payer: owner, payee: row.payee.toLowerCase(), authorizationId: row.authorization_id }) !== id)
      throw new Error("Original unavailable");
    if ([row.amount_usdc, row.creator_budget_usdc, row.service_fee_usdc].some(value => typeof value !== "number")) throw new Error("Invalid amounts");
    const paid = exactA2aMicros(row.amount_usdc as number), creator = exactA2aMicros(row.creator_budget_usdc as number), fee = exactA2aMicros(row.service_fee_usdc as number);
    if (paid === null || paid <= 0 || creator === null || fee === null || creator + fee !== paid ||
      row.request_hash !== a2aRequestHash({ question: request.question, model: request.model,
        creatorBudgetUsdc: creator / 1e6, serviceFeeUsdc: fee / 1e6, researchMode: row.research_mode, researchPackage: pkg }))
      throw new Error("Original mismatch");
    return { originalFingerprint: sha256(["keryx-acceptance-original-v1", storeId, network, owner, id, sha256(originalText)].join("|")),
      originalTextSha256: sha256(originalText), deliveredDigest: sha256(raw.deliveryText), answerDigest: sha256(response.answer), paidMicros: String(paid) };
  } catch { throw new AcceptanceError("acceptance_unavailable"); }
}

export function ownerSnapshot(binding: ReturnType<typeof originalBinding>, owner: string, network: string, id: string,
  latest: unknown, pendingPaymentLegs: boolean): AcceptanceSnapshot {
  const entry = latest === null ? null : acceptanceEntrySchema.parse(latest);
  if (entry && (entry.originalFingerprint !== binding.originalFingerprint || entry.deliveredDigest !== binding.deliveredDigest))
    throw new AcceptanceError("acceptance_conflict");
  return acceptanceSnapshotSchema.parse({ format: "keryx-deliverable-acceptance-v1", id, wallet: owner, network,
    originalFingerprint: binding.originalFingerprint, deliveredDigest: binding.deliveredDigest,
    answerDigest: binding.answerDigest,
    deliveryFormat: "retained-a2a-response-json-v1", revision: entry?.revision ?? 0,
    state: entry ? entry.choice === "accept" ? "accepted" : entry.choice === "revise" ? "revision_requested" : "rejected" : "no_response",
    submittedAt: entry?.submittedAt ?? null, reason: entry?.reason ?? null, publishState: entry?.publishState ?? false,
    terms: { remedy: "none", responseWindow: null, silence: "no_response" },
    revisionExecution: "withheld", refundExecution: "withheld", review: entry && entry.choice !== "accept" ? "owner_review_required" : "not_requested",
    pendingPaymentLegs, paidMicros: binding.paidMicros, funding: "prepaid-a2a" });
}
export function publicState(entry: AcceptanceEntry | null) {
  return publicAcceptanceSchema.parse({ format: "keryx-public-deliverable-state-v1",
    state: entry?.publishState ? entry.choice === "accept" ? "accepted" : entry.choice === "revise" ? "revision_requested" : "rejected" : "not_shared",
    submittedAt: entry?.publishState ? entry.submittedAt : null });
}
export function acceptanceMetrics(states: PublicAcceptance[]) {
  if (states.length > 1000) throw new AcceptanceError("acceptance_unavailable");
  return acceptanceMetricsSchema.parse({ format: "keryx-deliverable-choice-counts-v1", scope: "consented-current-prepaid-a2a",
    accepted: states.filter(state => state.state === "accepted").length, revisionRequested: states.filter(state => state.state === "revision_requested").length,
    rejected: states.filter(state => state.state === "rejected").length, outsideCustomers: null, team: null, noResponse: null, acceptanceRate: null, classification: "unmeasured" });
}

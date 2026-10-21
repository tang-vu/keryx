import { buildEvidenceProcurement, PROCUREMENT_NOTICE, type EvidenceProcurementResult } from "./engine";

export const PROCUREMENT_RECEIPT_FORMATS = ["json", "markdown", "csv"] as const;
export type ProcurementReceiptFormat = typeof PROCUREMENT_RECEIPT_FORMATS[number];
export const MAX_PROCUREMENT_RECEIPT_BYTES = 524_288;
const EXPORT_NOTICE = "Dated private inspection. Quote amounts and selections are proposals, not financial reservations. Provider stances and caller reviews remain declarations. Only the original JSON packet can be restored; this receipt grants no payment, payout or factual authority.";

// Match the established evidence CSV protection locally, without importing the
// research presentation module and its full UI catalogue into private receipts.
function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function procurementReceiptFormat(value: unknown): ProcurementReceiptFormat {
  if (value === undefined) return "json";
  if (typeof value !== "string" || !PROCUREMENT_RECEIPT_FORMATS.includes(value as ProcurementReceiptFormat))
    throw new Error("Invalid procurement receipt format");
  return value as ProcurementReceiptFormat;
}

const markdown = (text: string) => text.replace(/[\\`*_{}\[\]<>()#+\-.!|=@$~:]/g, "\\$&");
const quote = (text: string) => text.split(/\r\n|\r|\n/).map(line => `> ${markdown(line)}`).join("\n");
const list = (values: string[]) => values.join(", ") || "none";
const usdc = (value: string) => `${BigInt(value) / BigInt(1_000_000)}.${(BigInt(value) % BigInt(1_000_000)).toString().padStart(6, "0")} USDC`;
const requirementState = (result: EvidenceProcurementResult, id: string, declared: string) => declared === "covered"
  ? "caller-declared-covered" : result.missingRequirementIds.includes(id) ? "missing" : "caller-reviewed";

function markdownReceipt(result: EvidenceProcurementResult): string {
  const { packet } = result;
  const lines = ["# Private evidence procurement receipt", "", PROCUREMENT_NOTICE, "", EXPORT_NOTICE, "",
    `- Observation: ${result.observedAt}`, `- Request: ${markdown(packet.request.id)}`, `- Request hash: ${result.requestHash}`,
    `- Network: ${packet.request.network}`, `- Inspection state: ${result.state}`, `- Recorded payment status: ${result.payment.status}`, "",
    "## Decision", "", quote(packet.request.decision), "", "## Quote budget (proposal only)", "",
    `- Maximum: ${usdc(result.quoteBudget.maximumMicroUsdc)} (${result.quoteBudget.maximumMicroUsdc} micro-USDC)`,
    `- Selected quote total: ${usdc(result.quoteBudget.plannedMicroUsdc)} (${result.quoteBudget.plannedMicroUsdc} micro-USDC)`,
    `- Remaining: ${usdc(result.quoteBudget.remainingMicroUsdc)} (${result.quoteBudget.remainingMicroUsdc} micro-USDC)`,
    `- Request expires: ${packet.request.expiresAt}`,
    `- Recommended next offer: ${result.recommendation ? markdown(result.recommendation.offerId) : "none"}`, "",
    "## Evidence requirements", ""];
  for (const row of packet.request.requirements) lines.push(`### ${markdown(row.id)}`, "", quote(row.question), "",
    `Declared priority: ${row.priority}; inspection status: ${requirementState(result, row.id, row.status)}.`, "");
  lines.push("## Provider quotations", "");
  if (!result.offers.length) lines.push("No supplied quotations.", "");
  for (const [index, row] of result.offers.entries()) {
    const original = packet.offers[index];
    lines.push(`### ${markdown(row.id)} (quotation ${index + 1})`, "", `- Inspection: ${row.reason}`,
      `- Selected proposal: ${row.selected ? "yes" : "no"}; recommended next: ${result.recommendation?.offerId === row.id ? "yes" : "no"}`,
      `- Quoted amount: ${usdc(row.priceMicroUsdc)} (${row.priceMicroUsdc} micro-USDC)`, `- Provider wallet: ${row.providerWallet}`,
      `- Supplied source URL (not fetched): ${markdown(row.sourceUrl)}`, `- Offer hash: ${row.offerHash}`,
      `- Offer request hash: ${original.requestHash}`, `- Quote expires: ${original.expiresAt}`,
      `- Proposed requirements: ${markdown(list(row.proposedRequirementIds))}`, `- New proposed requirements: ${markdown(list(row.newRequirementIds))}`,
      "", "Provider-declared deliverable:", "", quote(original.deliverable), "");
  }
  lines.push("## Supplied deliveries", "");
  if (!result.deliveries.length) lines.push("No supplied deliveries.", "");
  for (const [index, row] of result.deliveries.entries()) {
    lines.push(`### ${markdown(row.offerId)}`, "", `- Inspection: ${row.reason}`, `- Delivery hash: ${row.deliveryHash}`,
      `- Delivery offer hash: ${packet.deliveries[index].offerHash}`, `- Supplied body hash: ${packet.deliveries[index].bodyHash}`, "");
    for (const excerpt of row.excerpts) lines.push(`Requirement: ${markdown(excerpt.requirementId)}; provider-declared stance: ${excerpt.stance}; UTF-16 span: [${excerpt.start}, ${excerpt.end}).`,
      "", quote(excerpt.text), "");
  }
  lines.push("## Caller reviews (not independent acceptance)", "");
  if (!result.reviews.length) lines.push("No supplied caller reviews.", "");
  for (const row of result.reviews) lines.push(`### ${markdown(row.offerId)}`, "", `- Inspection: ${row.reason}; authority: ${row.authority}`,
    `- Delivery hash: ${row.deliveryHash}`, `- Accepted requirements in this bound caller review: ${markdown(list(row.acceptedRequirementIds))}`,
    "", "Caller-declared reviewer:", "", quote(row.reviewer), "", "Caller note:", "", quote(row.reviewerNote), "");
  return lines.join("\n");
}

const COLUMNS = ["record_type", "record_index", "observed_at", "request_id", "request_hash", "network", "payment_status", "quote_budget_authority",
  "request_state", "decision", "maximum_quote_micro_usdc", "planned_quote_micro_usdc", "remaining_quote_micro_usdc", "request_expires_at",
  "requirement_id", "question", "priority", "requirement_state", "offer_id", "offer_hash", "offer_request_hash", "provider_wallet", "source_url", "deliverable",
  "offer_price_micro_usdc", "offer_reason", "selected", "recommended_next", "proposed_requirement_ids", "new_requirement_ids", "quote_expires_at",
  "delivery_hash", "delivery_offer_hash", "supplied_body_hash", "delivery_reason", "excerpt_start_utf16", "excerpt_end_utf16", "provider_declared_stance", "stance_authority", "exact_excerpt",
  "reviewer", "reviewer_note", "review_reason", "review_authority", "caller_accepted_requirement_ids", "authority_notice"] as const;
type CsvRow = Partial<Record<typeof COLUMNS[number], string>>;
function csvReceipt(result: EvidenceProcurementResult): string {
  const rows: CsvRow[] = [];
  const common: CsvRow = { observed_at: result.observedAt, request_id: result.packet.request.id, request_hash: result.requestHash,
    network: result.packet.request.network, payment_status: result.payment.status, quote_budget_authority: result.quoteBudget.authority };
  const add = (record_type: string, record_index: string, values: CsvRow) => rows.push({ ...common, record_type, record_index, ...values });
  add("request", "0", { request_state: result.state, decision: result.packet.request.decision,
    maximum_quote_micro_usdc: result.quoteBudget.maximumMicroUsdc, planned_quote_micro_usdc: result.quoteBudget.plannedMicroUsdc,
    remaining_quote_micro_usdc: result.quoteBudget.remainingMicroUsdc, request_expires_at: result.packet.request.expiresAt,
    authority_notice: `${PROCUREMENT_NOTICE} ${EXPORT_NOTICE}` });
  result.packet.request.requirements.forEach((row, index) => add("requirement", String(index), { requirement_id: row.id, question: row.question,
    priority: String(row.priority), requirement_state: requirementState(result, row.id, row.status) }));
  result.offers.forEach((row, index) => add("offer", String(index), { offer_id: row.id, offer_hash: row.offerHash,
    offer_request_hash: result.packet.offers[index].requestHash, provider_wallet: row.providerWallet,
    source_url: row.sourceUrl, deliverable: result.packet.offers[index].deliverable, offer_price_micro_usdc: row.priceMicroUsdc,
    offer_reason: row.reason, selected: String(row.selected), recommended_next: String(result.recommendation?.offerId === row.id),
    proposed_requirement_ids: row.proposedRequirementIds.join(" "), new_requirement_ids: row.newRequirementIds.join(" "),
    quote_expires_at: result.packet.offers[index].expiresAt }));
  result.deliveries.forEach((row, index) => {
    add("delivery", String(index), { offer_id: row.offerId, delivery_hash: row.deliveryHash, delivery_reason: row.reason,
      delivery_offer_hash: result.packet.deliveries[index].offerHash, supplied_body_hash: result.packet.deliveries[index].bodyHash });
    row.excerpts.forEach((excerpt, at) => add("delivery_excerpt", `${index}:${at}`, { offer_id: row.offerId, delivery_hash: row.deliveryHash,
      delivery_reason: row.reason, requirement_id: excerpt.requirementId, excerpt_start_utf16: String(excerpt.start), excerpt_end_utf16: String(excerpt.end),
      provider_declared_stance: excerpt.stance, stance_authority: excerpt.stanceAuthority, exact_excerpt: excerpt.text }));
  });
  result.reviews.forEach((row, index) => add("review", String(index), { offer_id: row.offerId, delivery_hash: row.deliveryHash,
    reviewer: row.reviewer, reviewer_note: row.reviewerNote, review_reason: row.reason, review_authority: row.authority,
    caller_accepted_requirement_ids: row.acceptedRequirementIds.join(" ") }));
  return [COLUMNS.map(csvCell).join(","), ...rows.map(row => COLUMNS.map(column => csvCell(row[column] ?? "")).join(","))].join("\r\n") + "\r\n";
}

// The strict packet is already a bounded plain-data copy. Inspect actual string
// values rather than JSON escape sequences, which can also be literal prose.
function hasNonDisplayableText(value: unknown): boolean {
  if (typeof value === "string") return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
  return value !== null && typeof value === "object" && Object.values(value).some(hasNonDisplayableText);
}

/** Rebuild only original inputs. A formatted receipt is never accepted as import authority. */
export async function exportEvidenceProcurement(value: unknown, format: unknown, now = Date.now()) {
  const selected = procurementReceiptFormat(format);
  if (selected === "json") throw new Error("Use original procurement JSON contract");
  const procurement = await buildEvidenceProcurement(value, now);
  // A readable file must not silently hide non-displayable control bytes. The original JSON remains available.
  if (hasNonDisplayableText(procurement.packet))
    throw new Error("Procurement receipt contains non-displayable text");
  const text = selected === "markdown" ? markdownReceipt(procurement) : csvReceipt(procurement);
  if (new TextEncoder().encode(text).byteLength > MAX_PROCUREMENT_RECEIPT_BYTES) throw new Error("Procurement receipt exceeds output bound");
  return { procurement, text, format: selected, extension: selected === "markdown" ? "md" : "csv",
    contentType: selected === "markdown" ? "text/markdown;charset=utf-8" : "text/csv;charset=utf-8" } as const;
}

import type { Hex } from "viem";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUYER_ENDPOINT, BUYER_ORIGIN, buyerRequestSchema, newAuthorization, buyerJobId, type BuyerRequest, type BuyerAuthorization } from "./policy";
import { archiveBuyerReceipt, createBuyerJournal, readBuyerJournal, writeBuyerFile, type BuyerIntent } from "./journal";
import { buyerFetch, readBuyerJson, type BuyerFetch } from "./transport";
import { sellerPaymentEvidence, verifyBuyerJob, verifyBuyerReceipt } from "./verify-result";
import { quoteBuyer } from "./quote";
export { quoteBuyer } from "./quote";

export async function buyResearch(input: {
  request: BuyerRequest; payee: string; maxTotalMicros: string; payer: string; directory: string;
  sign: (authorization: BuyerAuthorization) => Promise<Hex>;
}, http: BuyerFetch = buyerFetch) {
  const request = buyerRequestSchema.parse(input.request);
  const requirement = await quoteBuyer(request, input.payee, input.maxTotalMicros, http);
  const authorization = newAuthorization(input.payer, requirement);
  const intent: BuyerIntent = { schema: "keryx-buyer-intent-v1", request, requirement, authorization, queryId: buyerJobId(authorization) };
  await createBuyerJournal(input.directory, intent);
  const signature = await input.sign(authorization);
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new Error("Signer returned an invalid EOA signature");
  // This boundary is durable BEFORE any bearer signature leaves this process.
  await writeBuyerFile(input.directory, "submission.json", { state: "submission_possible", at: new Date().toISOString(), queryId: intent.queryId });
  const payment = Buffer.from(JSON.stringify({ signature, authorization })).toString("base64");
  try {
    const response = await http(BUYER_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "payment-signature": payment }, body: JSON.stringify(request) });
    // Preserve payment evidence even when the response body is missing or HTTP is 5xx.
    const evidence = sellerPaymentEvidence(response.headers.get("payment-response"), intent);
    await writeBuyerFile(input.directory, "payment-response.json", { httpStatus: response.status, evidence });
    await response.body?.cancel();
    if (!evidence || !response.ok) return { queryId: intent.queryId, status: "submission_uncertain", message: "Delivery or settlement acknowledgement is uncertain. Resume the same journal; retained payment evidence is reported separately." };
  } catch {
    return { queryId: intent.queryId, status: "submission_uncertain", message: "Keep this journal. Resume only polls the original job; do not buy again to recover." };
  }
  return { queryId: intent.queryId, status: "submitted", message: "Use resume to fetch the original job. HTTP success alone is not settlement proof." };
}

/** No signer, payment header or POST path exists in recovery. */
export async function resumeResearch(directory: string, http: BuyerFetch = buyerFetch) {
  const intent = await readBuyerJournal(directory);
  let evidence = null;
  try {
    const saved = JSON.parse(await readFile(join(directory, "payment-response.json"), "utf8"));
    evidence = sellerPaymentEvidence(Buffer.from(JSON.stringify(saved.evidence)).toString("base64"), intent);
  } catch { /* Missing/lost/malformed acknowledgement never becomes settlement proof. */ }
  const payment = { state: evidence ? "seller_reported_settled" : "unconfirmed", evidence };
  const response = await http(`${BUYER_ENDPOINT}?queryId=${intent.queryId}`, { headers: { accept: "application/json" } });
  if (response.status === 404) {
    await response.body?.cancel();
    return { queryId: intent.queryId, status: "not_found_uncertain", payment, message: "No order found. This does not prove payment failed; retain the journal for operator review." };
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Job lookup failed (${response.status}); use the same journal to resume`); }
  const { job, packageFingerprint } = verifyBuyerJob(await readBuyerJson(response), intent);
  if (job.status !== "completed") return { ...job, packageFingerprint, payment };
  const receiptResponse = await http(`${BUYER_ORIGIN}/api/dispatch/${intent.queryId}/receipt`, { headers: { accept: "application/json" } });
  if (!receiptResponse.ok) { await receiptResponse.body?.cancel(); throw new Error("Receipt unavailable; retain this journal and resume later"); }
  const receipt = await readBuyerJson(receiptResponse);
  const verification = verifyBuyerReceipt(receipt, receiptResponse.headers.get("x-keryx-receipt-digest"), intent, job.answer!);
  // Content-addressed files retain earlier snapshots when reconciliation changes settlement.
  const name = `receipt-${verification.digest.slice(7)}.json`;
  await archiveBuyerReceipt(directory, name, receipt);
  return { ...job, packageFingerprint, payment, verification, receiptFile: name, workspace: `${BUYER_ORIGIN}/research` };
}

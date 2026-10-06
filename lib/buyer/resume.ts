import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUYER_ENDPOINT, BUYER_ORIGIN } from "./policy";
import { archiveBuyerReceipt, readBuyerJournal } from "./journal";
import { buyerFetch, readBuyerJson, type BuyerFetch } from "./transport";
import { sellerPaymentEvidence, verifyBuyerJob, verifyBuyerReceipt } from "./verify-result";

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

import { recoverTypedDataAddress, type Hex } from "viem";
import { BUYER_ENDPOINT, BuyerRefusal, addressSchema, buyerRequestSchema, buyerTypedData, newAuthorization, buyerJobId, type BuyerRequest, type BuyerAuthorization } from "./policy";
import { createBuyerJournal, writeBuyerFile, type BuyerIntent } from "./journal";
import { buyerFetch, type BuyerFetch } from "./transport";
import { sellerPaymentEvidence } from "./verify-result";
import { quoteBuyer } from "./quote";
import { canonicalJson } from "../canonical-json";
import { assertBuyerSubmissionAvailable, assertPreparedAuthorizationCurrent, claimBuyerSubmission, readPreparedBuyerJournal, recordBuyerPreparation } from "./prepared-journal";
export { quoteBuyer } from "./quote";
export { resumeResearch } from "./resume";

export interface PrepareResearchInput {
  request: BuyerRequest; payee: string; maxTotalMicros: string; payer: string; directory: string;
}
export interface SubmitPreparedResearchInput {
  directory: string; payer: string;
  sign: (authorization: BuyerAuthorization) => Promise<Hex>;
  /** Trusted code admission, never deserialized from request/quote/recovery input. */
  beforeDispatch?: (intent: BuyerIntent) => void | Promise<void>;
  expectedIntentDigest?: string;
}

/** Unsigned quote + immutable original journal. This function has no signer or payment-header path. */
export async function prepareResearch(input: PrepareResearchInput, http: BuyerFetch = buyerFetch) {
  const request = buyerRequestSchema.parse(input.request);
  const requirement = await quoteBuyer(request, input.payee, input.maxTotalMicros, http);
  const authorization = newAuthorization(input.payer, requirement);
  const intent: BuyerIntent = { schema: "keryx-buyer-intent-v1", request, requirement, authorization, queryId: buyerJobId(authorization) };
  await createBuyerJournal(input.directory, intent);
  const prepared = await recordBuyerPreparation(input.directory, intent, input.maxTotalMicros);
  return Object.freeze({ queryId: intent.queryId, status: "prepared" as const, intentDigest: prepared.intentDigest, intent: prepared.intent });
}

/** A separate submit re-quotes, but can never substitute a new nonce, body or payment requirement. */
export async function submitPreparedResearch(input: SubmitPreparedResearchInput, http: BuyerFetch = buyerFetch) {
  return submitOriginalResearch(input, http);
}

/** Preserve ordinary buy's single unsigned quote followed by one paid POST. No public re-quote bypass. */
export async function buyResearch(input: PrepareResearchInput & Pick<SubmitPreparedResearchInput, "sign" | "beforeDispatch">, http: BuyerFetch = buyerFetch) {
  const prepared = await prepareResearch(input, http);
  return submitOriginalResearch({ ...input, expectedIntentDigest: prepared.intentDigest }, http, prepared.intent.requirement);
}

async function submitOriginalResearch(input: SubmitPreparedResearchInput, http: BuyerFetch, immediateQuote?: BuyerIntent["requirement"]) {
  const prepared = await readPreparedBuyerJournal(input.directory, input.expectedIntentDigest);
  const { intent, intentDigest } = prepared;
  if (addressSchema.parse(input.payer).toLowerCase() !== intent.authorization.from.toLowerCase()) {
    throw new BuyerRefusal("SKIP: signer does not match the original prepared payer");
  }
  await assertBuyerSubmissionAvailable(input.directory);
  assertPreparedAuthorizationCurrent(intent);
  const current = immediateQuote ?? await quoteBuyer(intent.request, intent.requirement.payTo, prepared.maxTotalMicros, http);
  if (canonicalJson(current) !== canonicalJson(intent.requirement)) {
    throw new BuyerRefusal("SKIP: current quote changed; retain the original for review without signing");
  }
  // Recovery-only consumers must not load the operational policy or its side effects.
  const { assertPreparedCanarySubmission } = await import("../business-operator/canary-policy");
  await input.beforeDispatch?.(intent);
  // Configured finite policy applies to every submission, including generic/composed buys.
  assertPreparedCanarySubmission(intent);
  await readPreparedBuyerJournal(input.directory, intentDigest);
  await claimBuyerSubmission(input.directory, intent, intentDigest);
  assertPreparedAuthorizationCurrent(intent);
  // Failure or cancellation here consumes the attempt too. Never re-sign or re-POST this original.
  const signature = await input.sign(intent.authorization);
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new BuyerRefusal("SKIP: signer returned an invalid EOA signature; resume the original journal");
  const signer = await recoverTypedDataAddress({ ...buyerTypedData(intent.authorization), signature });
  if (signer.toLowerCase() !== intent.authorization.from.toLowerCase()) {
    throw new BuyerRefusal("SKIP: signature does not bind the original payer; resume the original journal");
  }
  await readPreparedBuyerJournal(input.directory, intentDigest);
  assertPreparedAuthorizationCurrent(intent);
  assertPreparedCanarySubmission(intent);
  const payment = Buffer.from(JSON.stringify({ signature, authorization: intent.authorization })).toString("base64");
  try {
    const response = await http(BUYER_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "payment-signature": payment }, body: JSON.stringify(intent.request) });
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

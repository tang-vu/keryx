/** Synthetic test-only canary authority. No actual article, credential or settlement is used. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { a2aOrderId, type A2aOrder } from "../a2a/order";
import { a2aResearchPackageForVersion } from "../a2a/research-package";
import { fulfillmentSha256, type A2aFulfillmentClaim, type A2aFulfillmentRecord,
  type FulfillmentClaimInput, type A2aFulfillmentCompletion } from "../a2a/failed-original-fulfillment-protocol";
import type { BuyerIntent } from "../buyer/journal";
import type { KeryxDB } from "../db/keryx-db";
import { activateBusinessCanary, admitBusinessCanaryRun, assertPreparedCanarySubmission, reserveCanaryInboundSettlement,
  bindBusinessCanaryAdmission, reserveCanaryModel, reserveCanarySearch, businessCanaryHostIdentity,
  canaryOriginalClaim, closeVerifiedFailedBusinessCanary, retainedFailedBusinessCanaryAuthority, type BusinessCanaryPolicy } from "./canary-policy";
import { fulfillmentDirectory, readFrozenFulfillmentPacket, readFulfillmentAuthorization,
  type FulfillmentAuthorization } from "./fulfillment-policy";
import type { FulfillmentSupplierWindow } from "../a2a/fulfillment-window";

export const fixtureNow = "2026-10-06T12:00:00.000Z", fixtureCommit = "c".repeat(40);
export const fixtureFlush = process.platform === "win32" ? () => {} : undefined;
export const fixtureRoots: string[] = [], fixtureHome = os.homedir();
export function cleanFulfillmentFixtures() {
  for (const root of fixtureRoots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== fixtureHome || !path.basename(root).startsWith("keryx-fulfillment-test-")) throw new Error("Fixture cleanup target refused");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export async function fulfillmentFixture(fiveTargets = false) {
  const root = fs.mkdtempSync(path.join(fixtureHome, "keryx-fulfillment-test-")); fixtureRoots.push(root); fs.chmodSync(root, 0o700);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  const oldDirectory = path.join(root, ".local", "share", "keryx-business-canary"); fs.mkdirSync(oldDirectory, { recursive: true, mode: 0o700 });
  const from = `0x${"1".repeat(40)}`, to = `0x${"2".repeat(40)}`, nonce = `0x${"a".repeat(64)}`;
  const question = fiveTargets
    ? "Explain contract-signature compatibility, EOA authorization, Nanopayments, TEE limitations and operational checks including the Arc deployment profile. Cite each answer."
    : "How is authorization checked, and how does settlement work? Use official documentation and cite each answer.";
  const original: BuyerIntent = { schema: "keryx-buyer-intent-v1", request: { question, budget: 0.01,
    researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" },
    requirement: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      amount: "30000", payTo: to, maxTimeoutSeconds: 691200,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    authorization: { from, to, value: "30000", nonce, validAfter: "1791248400", validBefore: "1791936000" },
    queryId: a2aOrderId({ network: ARC_MAINNET_PROFILE.networkId, payer: from, payee: to, authorizationId: nonce }) };
  const policy: BusinessCanaryPolicy = { format: "keryx-business-canary-v1", approvalId: "operator-business-20261006",
    approvedAt: "2026-10-06T03:23:02.644Z", expiresAt: "2026-10-07T00:00:00.000Z", priceCheckedOn: "2026-10-06",
    maximumOriginals: 1, maximumMicroUsd: 250000, maximumMicroUsdc: 60000, creatorPaymentMode: "forbidden",
    executionHostSha256: businessCanaryHostIdentity(), original };
  const oldFile = path.join(root, "old-policy.json"); fs.writeFileSync(oldFile, JSON.stringify(policy), { mode: 0o600 });
  const oldDigest = fulfillmentSha256(fs.readFileSync(oldFile)); activateBusinessCanary(oldFile, oldDigest, fixtureFlush);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", oldFile); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", oldDigest);
  assertPreparedCanarySubmission(original, fixtureFlush); reserveCanaryInboundSettlement(fixtureFlush);
  const binding = canaryOriginalClaim()!;
  const admission = admitBusinessCanaryRun({ queryId: original.queryId, question, budget: 0.01, origin: "a2a",
    researchMode: "quick", fundingOwner: "treasury", privateScope: false }, fixtureFlush)!;
  const generator = bindBusinessCanaryAdmission(admission, (async function* () {
    reserveCanaryModel("Fixture policy", "Fixture data", 2048); reserveCanarySearch("fixture first"); reserveCanarySearch("fixture second"); yield true;
  })()); await generator.next(); await generator.return();
  const order: A2aOrder = { id: binding.id, queryId: binding.queryId, authorizationId: binding.authorizationId,
    requestHash: binding.requestHash, payer: binding.payer, payee: binding.payee, amountUsdc: 0.03, creatorBudgetUsdc: 0.01,
    serviceFeeUsdc: 0.02, researchMode: "quick", researchPackage: a2aResearchPackageForVersion("quick", "1.0.0")!,
    status: "failed", transaction: "synthetic-inbound-fixture-proof", request: { question, origin: "a2a", network: ARC_MAINNET_PROFILE.networkId },
    startedAt: "2026-10-06T11:59:59.000Z", workerId: "fixture-worker", executionJournalVersion: 1,
    paymentStartedAt: null, resultSavingAt: null, response: null, errorCode: "research_failed", resolution: null,
    createdAt: "2026-10-06T11:59:58.000Z", updatedAt: fixtureNow };
  let record: A2aFulfillmentRecord | null = null;
  const db = { getA2aOrder: vi.fn(async () => order), getQueryRun: vi.fn(async () => null),
    hasA2aOriginalSettlement: vi.fn(async () => true), listCreatorPaymentAttemptsByQuery: vi.fn(async () => []),
    claimA2aFailedOriginalFulfillment: vi.fn(async (input: FulfillmentClaimInput) => {
      if (record) return null; const claim: A2aFulfillmentClaim = { ...input, failedOrder: structuredClone(order) };
      record = { claim, completion: null }; return claim;
    }), getA2aFailedOriginalFulfillment: vi.fn(async () => record),
    completeA2aFailedOriginalFulfillment: vi.fn(async (input: A2aFulfillmentCompletion) => {
      if (!record) return false;
      const { run: _run, ...completion } = input; record = { ...record, completion }; return true;
    }), hasA2aFailedOriginalFulfillment: vi.fn(async () => !!record?.completion) } as unknown as KeryxDB;
  await closeVerifiedFailedBusinessCanary(db, fixtureFlush);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", undefined); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
  const old = retainedFailedBusinessCanaryAuthority();
  fs.mkdirSync(fulfillmentDirectory(), { mode: 0o700 });
  const docs = fiveTargets ? [
    "The contract signature flow validates ERC-1271 contract signatures before a Gateway transfer. The EOA authorization flow checks an EOA signature before batching a transfer. The TEE validation component is required by this contract-signature flow.",
    "Nanopayments uses EOA signatures and does not support ERC-1271 contract signatures. Before a Nanopayments transfer, check the nonce and signed amount against the exact payment requirement.",
  ] : ["The authorization contract checks the signature before permitting a transfer.", "The settlement service records a confirmed transfer before delivering the paid response."];
  const documents = docs.map((body, index) => {
    const id = `document-${index + 1}`, bodyFile = `${id}.txt`; fs.writeFileSync(path.join(root, bodyFile), body, { mode: 0o600 });
    return { id, requestedUrl: `https://developers.circle.com/fixture/${id}`, finalUrl: `https://developers.circle.com/fixture/${id}`,
      title: `Synthetic fixture document ${index + 1}`, retrievedAt: "2026-10-06T11:00:00.000Z", extraction: "html", truncated: false,
      bodyFile, bodySha256: fulfillmentSha256(body), bodyBytes: Buffer.byteLength(body) };
  });
  const manifestFile = path.join(root, "manifest.json"), manifest = { format: "keryx-frozen-official-canary-documents-v1",
    reader: "lib/web-research/article-reader.ts", documents };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 }); const manifestDigest = fulfillmentSha256(fs.readFileSync(manifestFile));
  const input = { format: "keryx-canary-original-fulfillment-input-v1", questionSha256: fulfillmentSha256(question),
    scopeBasis: "reviewed-original-question-reconstruction", targets: fiveTargets ? [
      "Explain contract-signature compatibility.", "Explain the EOA authorization flow.", "Explain the Nanopayments flow.",
      "Explain TEE and contract-signature limitations.", "Give operational checks and identify missing Arc deployment details.",
    ] : ["How is authorization checked?", "How does settlement work?"],
    constraints: ["Use official documentation and cite each answer."], sourceManifestSha256: manifestDigest,
    selectedDocumentIds: documents.map(item => item.id) };
  const inputFile = path.join(root, "input.json"); fs.writeFileSync(inputFile, JSON.stringify(input), { mode: 0o600 });
  const inputDigest = fulfillmentSha256(fs.readFileSync(inputFile));
  const packet = readFrozenFulfillmentPacket(inputFile, inputDigest, manifestFile, manifestDigest);
  const tariffFile = path.join(root, "tariff.txt"); fs.writeFileSync(tariffFile, "Synthetic tariff capture fixture.", { mode: 0o600 });
  const authorization: FulfillmentAuthorization = { format: "keryx-canary-original-fulfillment-authorization-v1",
    approvalId: "operator-business-20261006", approvedAt: "2026-10-06T11:30:00.000Z", executionHostSha256: businessCanaryHostIdentity(),
    executorCommit: fixtureCommit, policySha256: old.policySha256, failedClosureSha256: old.failedClosureSha256,
    originalEvidenceSha256: old.originalEvidenceSha256, originalProviderLedgerSha256: old.originalProviderLedgerSha256,
    inputFile, inputSha256: inputDigest, inputSemanticSha256: packet.inputSemanticSha256,
    sourceManifestFile: manifestFile, sourceManifestSha256: manifestDigest, packetSha256: packet.packetSha256,
    requiredSupportedTargetIndexes: fiveTargets ? [0, 1, 2, 3, 4] : [0],
    tariffFile, tariffBodySha256: fulfillmentSha256(fs.readFileSync(tariffFile)), tariffUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
    tariffRetrievedAt: "2026-10-06T11:00:00.000Z", tariffInputUsdPerMillion: 0.30, tariffOutputUsdPerMillion: 1.20,
    provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash",
    expiresAt: "2026-10-07T00:00:00.000Z", maximumNewModelCalls: 3, reserveMicroUsd: 20660, originalReservedMicroUsd: 36660,
    creatorPayments: "forbidden", searches: "forbidden" };
  const authorizationFile = path.join(root, "authorization.json"); fs.writeFileSync(authorizationFile, JSON.stringify(authorization), { mode: 0o600 });
  const authorizationDigest = fulfillmentSha256(fs.readFileSync(authorizationFile));
  return { root, oldDirectory, order, db, packet, authorization, authorizationFile, authorizationDigest,
    binding: readFulfillmentAuthorization(authorizationFile, authorizationDigest), docs, old };
}

/** Explicit synthetic window only; never used to provision actual permission. */
export function withFulfillmentSupplierWindow(value: Awaited<ReturnType<typeof fulfillmentFixture>>,
  supplierWindow: FulfillmentSupplierWindow, approvedAt: string) {
  const authorization: FulfillmentAuthorization = { ...value.authorization,
    format: "keryx-canary-original-fulfillment-authorization-v2", supplierWindow,
    approvedAt, expiresAt: supplierWindow.expiresAt };
  fs.writeFileSync(value.authorizationFile, JSON.stringify(authorization));
  const authorizationDigest = fulfillmentSha256(fs.readFileSync(value.authorizationFile));
  return { ...value, authorization, authorizationDigest,
    binding: readFulfillmentAuthorization(value.authorizationFile, authorizationDigest) };
}

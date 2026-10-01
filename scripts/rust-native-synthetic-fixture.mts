/**
 * One TypeScript-written completed v1 task for native artifact acceptance.
 * The injected responses are synthetic and never touch a live service.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { a2aResearchPackage } from "../lib/a2a/research-package-definition.ts";
import { createBuyerJournal, readBuyerJournal } from "../lib/buyer/journal.ts";
import { buyerJobId } from "../lib/buyer/policy.ts";
import { resumeResearch } from "../lib/buyer/client.ts";
import { authorizationWithNonce, BUYER_ENDPOINT, BUYER_ORIGIN, BUYER_GATEWAY,
  BUYER_NETWORK, BUYER_USDC } from "../lib/buyer/protocol.ts";
import { formatOperatorBrief, operatorTaskStatus, readOperatorResult,
  resumeOperatorTask } from "../lib/operator/task.ts";
import { createLegacyOperatorTask } from "../test-support/legacy-operator-task.ts";
import { RESEARCH_RECEIPT_CANONICALIZATION, RESEARCH_RECEIPT_SCHEMA } from "../lib/research-receipt-types.ts";
import { researchReceiptDigest, sha256 } from "../lib/research-receipt-integrity.ts";

const payer = `0x${"1".repeat(40)}`;
const payee = `0x${"2".repeat(40)}`;
const request = { question: "Synthetic copied-artifact question", budget: 0.03,
  researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" } as const;

export async function digestTree(directory: string) {
  const entries: string[] = [];
  async function walk(path: string, relative: string) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name);
      const key = join(relative, name);
      const kind = await lstat(file);
      if (kind.isDirectory()) { entries.push(`dir ${key}`); await walk(file, key); }
      else if (kind.isFile()) entries.push(`file ${key} ${createHash("sha256").update(await readFile(file)).digest("hex")}`);
      else throw new Error(`Unexpected fixture entry: ${key}`);
    }
  }
  await walk(directory, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

export async function writtenV1(state: string, recordedArticle = false) {
  await createLegacyOperatorTask(state, { request, payee, maxTotalMicros: "100000" });
  const requirement = { scheme: "exact" as const, network: BUYER_NETWORK as "eip155:5042002",
    asset: BUYER_USDC, amount: "50000", payTo: payee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched" as const, version: "1" as const,
      verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce(payer, requirement, `0x${"a".repeat(64)}`);
  await createBuyerJournal(join(state, "buyer"), { schema: "keryx-buyer-intent-v1", request,
    requirement, authorization, queryId: buyerJobId(authorization) });
  // The production snapshot writer requires exact canonical directory paths.
  // Windows TEMP can spell the same directory with a different alias/casing.
  assert.equal(await realpath(state), resolve(state), "fixture task path is not canonical");
  assert.equal(await realpath(join(state, "buyer")), join(resolve(state), "buyer"),
    "fixture buyer path is not canonical");
  const intent = await readBuyerJournal(join(state, "buyer"));
  const answer = "Synthetic native artifact answer [1]";
  const job = { queryId: intent.queryId, status: "completed", answer,
    researchPackage: a2aResearchPackage(request.researchMode),
    pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03,
      settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005,
      unusedCreatorReserveUsdc: 0.015 } };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: request.question, answer, answerSha256: sha256(answer),
      budgetUsdc: request.budget, researchMode: request.researchMode },
    citations: [{ marker: "[1]", sourceName: "Synthetic creator", ...(recordedArticle ? {
      sourceId: "synthetic", itemId: "item", itemTitle: "Observed synthetic article", itemUrl: "https://example.org/article",
      contentVersion: "v1", weight: 1, rewardPlannedUsdc: 0.01, rationale: "recorded" } : {}) }],
    ...(recordedArticle ? { claims: [{ claimIndex: 0, claim: "Synthetic claim", evidence: [{ marker: "[1]",
      sourceId: "synthetic", sourceName: "Synthetic creator", itemId: "item", contentVersion: "v1",
      quote: "Synthetic bounded excerpt", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: true }] }] } : {}),
    settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01,
      pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 } };
  const receiptDigest = researchReceiptDigest(payload);
  const receipt = { payload, integrity: { algorithm: "sha256",
    canonicalization: RESEARCH_RECEIPT_CANONICALIZATION, scope: "payload", digest: receiptDigest } };
  let calls = 0;
  const http = async (url: string, init: RequestInit = {}) => {
    calls++;
    assert.equal(init.method ?? "GET", "GET");
    assert.deepEqual(init.headers, { accept: "application/json" });
    assert.equal(init.body, undefined);
    if (url === `${BUYER_ENDPOINT}?queryId=${intent.queryId}`) {
      assert.equal(calls, 1);
      return Response.json(job);
    }
    assert.equal(url, `${BUYER_ORIGIN}/api/dispatch/${intent.queryId}/receipt`);
    assert.equal(calls, 2);
    return Response.json(receipt, { headers: { "x-keryx-receipt-digest": receiptDigest } });
  };
  const saved = await resumeOperatorTask(state, buyer => resumeResearch(buyer, http as typeof fetch));
  assert.equal(saved.localResult.state, "saved");
  assert.equal(calls, 2);
  const status = await operatorTaskStatus(state);
  const result = await readOperatorResult(state);
  assert(result);
  assert.equal(status.savedResult, "present_unchecked");
  assert.equal(result.answer, answer);
  return { status, result, brief: Buffer.from(`${formatOperatorBrief(result)}\n`, "utf8") };
}

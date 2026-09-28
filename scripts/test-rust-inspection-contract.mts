/** Deterministic inter-file read contract, seeded by the production TypeScript writer. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { a2aResearchPackage } from "../lib/a2a/research-package-definition.ts";
import { createBuyerJournal, readBuyerJournal } from "../lib/buyer/journal.ts";
import { buyerJobId } from "../lib/buyer/policy.ts";
import { authorizationWithNonce, BUYER_ENDPOINT, BUYER_ORIGIN, BUYER_GATEWAY,
  BUYER_NETWORK, BUYER_USDC } from "../lib/buyer/protocol.ts";
import { resumeResearch } from "../lib/buyer/client.ts";
import { createOperatorTask, formatOperatorBrief, operatorTaskStatus, readOperatorResult,
  resumeOperatorTask } from "../lib/operator/task.ts";
import { RESEARCH_RECEIPT_CANONICALIZATION, RESEARCH_RECEIPT_SCHEMA } from "../lib/research-receipt-types.ts";
import { researchReceiptDigest, sha256 } from "../lib/research-receipt-integrity.ts";

const repo = resolve(import.meta.dirname, "..");
const payee = `0x${"2".repeat(40)}`;
const payer = `0x${"1".repeat(40)}`;
const request = { question: "What is Arc doing?", budget: 0.03, researchMode: "quick",
  packageVersion: "1.0.0", responseMode: "async" } as const;

async function seed(path: string) {
  await createOperatorTask(path, { request, payee, maxTotalMicros: "100000" });
  const requirement = { scheme: "exact" as const, network: BUYER_NETWORK as "eip155:5042002",
    asset: BUYER_USDC, amount: "50000", payTo: payee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched" as const, version: "1" as const,
      verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce(payer, requirement, `0x${"a".repeat(64)}`);
  await createBuyerJournal(join(path, "buyer"), { schema: "keryx-buyer-intent-v1", request,
    requirement, authorization, queryId: buyerJobId(authorization) });
}

async function complete(path: string, answer: string, timestamp: string) {
  assert.equal(await realpath(path), resolve(path));
  const intent = await readBuyerJournal(join(path, "buyer"));
  const job = { queryId: intent.queryId, status: "completed", answer,
    researchPackage: a2aResearchPackage(request.researchMode),
    pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03,
      settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005,
      unusedCreatorReserveUsdc: 0.015 } };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: request.question, answer, answerSha256: sha256(answer),
      budgetUsdc: request.budget, researchMode: request.researchMode },
    citations: [{ marker: "[1]", sourceName: "Synthetic creator" }],
    settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01,
      pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 } };
  const digest = researchReceiptDigest(payload);
  const receipt = { payload, integrity: { algorithm: "sha256",
    canonicalization: RESEARCH_RECEIPT_CANONICALIZATION, scope: "payload", digest } };
  let calls = 0;
  const http = async (url: string, init: RequestInit = {}) => {
    calls++;
    assert.equal(init.method ?? "GET", "GET", "synthetic recovery must stay GET-only");
    assert.deepEqual(init.headers, { accept: "application/json" });
    assert.equal(init.body, undefined);
    if (url === `${BUYER_ENDPOINT}?queryId=${intent.queryId}`) {
      assert.equal(calls, 1, "job GET must be first and unique");
      return Response.json(job);
    }
    assert.equal(url, `${BUYER_ORIGIN}/api/dispatch/${intent.queryId}/receipt`, "unexpected recovery URL");
    assert.equal(calls, 2, "receipt GET must be second and unique");
    return Response.json(receipt, { headers: { "x-keryx-receipt-digest": digest } });
  };
  const saved = await resumeOperatorTask(path, buyer => resumeResearch(buyer, http as typeof fetch));
  assert.equal(calls, 2);
  assert.equal(saved.localResult.state, "saved");
  const snapshotPath = join(path, "result.json");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  snapshot.savedAt = timestamp;
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const observationPath = join(path, "last-observation.json");
  const observation = JSON.parse(await readFile(observationPath, "utf8"));
  observation.observedAt = timestamp;
  await writeFile(observationPath, JSON.stringify(observation));
  const result = await readOperatorResult(path);
  assert(result);
  assert.equal(result.answer, answer);
  assert.equal(result.savedAt, timestamp);
  return { status: await operatorTaskStatus(path), result, brief: formatOperatorBrief(result),
    snapshot, observation };
}

async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "keryx-inter-file-")));
  try {
    const seedPath = join(root, "seed");
    await seed(seedPath);
    const oldPath = join(root, "old");
    const newPath = join(root, "new");
    await cp(seedPath, oldPath, { recursive: true });
    await cp(seedPath, newPath, { recursive: true });
    const old = await complete(oldPath, "Older synthetic answer [1]", "2026-09-28T00:00:00.000Z");
    const newer = await complete(newPath, "Newer synthetic answer [1]", "2026-09-29T00:00:00.000Z");
    assert.equal(old.status.taskId, newer.status.taskId);
    assert.equal(old.status.buyerJobId, newer.status.buyerJobId);
    assert.notEqual(old.result.receiptDigest, newer.result.receiptDigest);
    assert.notEqual(old.result.savedAt, newer.result.savedAt);
    assert.notEqual(old.brief, newer.brief);
    const oldNoResultPath = join(root, "old-observation-no-result");
    await cp(oldPath, oldNoResultPath, { recursive: true });
    await rm(join(oldNoResultPath, "result.json"));
    const oldNoResultStatus = await operatorTaskStatus(oldNoResultPath);
    assert.equal(oldNoResultStatus.savedResult, "absent");
    assert.equal(await readOperatorResult(oldNoResultPath), null);
    await writeFile(join(root, "oracle.json"), JSON.stringify({ old, newer, oldNoResultStatus }));

    const cargo = process.env.KERYX_TEST_CARGO || "cargo";
    const toolchain = process.env.KERYX_TEST_RUST_TOOLCHAIN;
    const args = [...(toolchain ? [`+${toolchain}`] : []), "test", "--manifest-path",
      join(repo, "rust", "Cargo.toml"), "-p", "keryx-core", "--locked",
      "io::tests::inter_file_contract_with_ts_written_v1_fixtures", "--",
      "--ignored", "--exact", "--nocapture"];
    const env = { ...process.env, KERYX_TEST_INSPECTION_FIXTURE_ROOT: root };
    const child = spawnSync(cargo, args, { cwd: repo, env, encoding: "utf8", maxBuffer: 4_000_000,
      timeout: 600_000, windowsHide: true });
    if (child.error) throw new Error(`inter-file Cargo test could not finish: ${child.error.message}`);
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr);
    assert.equal(child.status, 0, "inter-file native test failed");
    assert.match(child.stdout, /test io::tests::inter_file_contract_with_ts_written_v1_fixtures \.\.\. ok/,
      "inter-file native test did not execute");
    assert.match(child.stdout, /1 passed; 0 failed/, "inter-file native test did not pass exactly once");
  } finally { await rm(root, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });

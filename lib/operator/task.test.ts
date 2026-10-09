import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createBuyerJournal, readBuyerJournal } from "../buyer/journal";
import { resumeResearch } from "../buyer/client";
import { a2aResearchPackage } from "../a2a/research-package";
import { RESEARCH_RECEIPT_CANONICALIZATION, RESEARCH_RECEIPT_SCHEMA } from "../research-receipt-types";
import { researchReceiptDigest, sha256 } from "../research-receipt-integrity";
import { authorizationWithNonce, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "../buyer/protocol";
import { buyerJobId } from "../buyer/policy";
import { createOperatorTask, formatOperatorBrief, operatorTaskStatus, readOperatorResult, readOperatorResearchResult, resumeOperatorTask } from "./task";
import { createLegacyOperatorTask } from "../../test-support/legacy-operator-task";

const roots: string[] = [];
const payer = `0x${"1".repeat(40)}`;
const payee = `0x${"2".repeat(40)}`;
const otherPayee = `0x${"3".repeat(40)}`;
const request = { question: "What is Arc doing?", budget: 0.03, researchMode: "quick" as const,
  packageVersion: "1.0.0" as const, responseMode: "async" as const };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keryx-operator-task-"));
  roots.push(root);
  return { root, task: join(root, "task") };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function buyerJournal(task: string, overrides: { request?: typeof request; payee?: string; amount?: string } = {}) {
  const req = overrides.request ?? request;
  const recipient = overrides.payee ?? payee;
  const requirement = { scheme: "exact" as const, network: BUYER_NETWORK as "eip155:5042002", asset: BUYER_USDC,
    amount: overrides.amount ?? "50000", payTo: recipient, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched" as const, version: "1" as const, verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce(payer, requirement, `0x${"a".repeat(64)}`);
  await createBuyerJournal(join(task, "buyer"), { schema: "keryx-buyer-intent-v1", request: req,
    requirement, authorization, queryId: buyerJobId(authorization) });
}

it("delegates task creation to the native writer without a TypeScript write", async () => {
  const { task } = await fixture();
  const create = vi.fn(async (input: { id: string; child: string }) => ({ taskId: input.id,
    child: input.child, state: "unix_synced" as const }));
  const result = await createOperatorTask(task, { request, payee, maxTotalMicros: "100000" }, { create } as never);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ parent: dirname(task), child: basename(task),
    request, payee, maxTotalMicros: "100000", id: expect.any(String), createdAt: expect.any(String) }));
  expect(result).toMatchObject({ taskId: create.mock.calls[0][0].id, status: "ready", publicationState: "unix_synced" });
  await expect(readFile(join(task, "task.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("creates exactly one private task and keeps status/export free of research content and settlement claims", async () => {
  const { task } = await fixture();
  const attempts = await Promise.allSettled(Array.from({ length: 2 }, () => createLegacyOperatorTask(task,
    { request, payee, maxTotalMicros: "100000" })));
  expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter(x => x.status === "rejected")).toHaveLength(1);
  expect(JSON.parse(await readFile(join(task, "request.json"), "utf8"))).toEqual(request);
  const status = await operatorTaskStatus(task);
  expect(status.stage).toBe("ready");
  expect(status.payment).toBe("unknown");
  expect(status.delivery).toBe("unknown");
  expect(JSON.stringify(status)).not.toContain(request.question);
  expect(JSON.stringify(status)).not.toContain(payee);
});

it("binds recovery to the exact original request and caps before any GET", async () => {
  const { task } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" });
  await buyerJournal(task);
  const recover = vi.fn(async () => ({ status: "not_found_uncertain" as const,
    payment: { state: "unconfirmed" as const } }));
  expect((await operatorTaskStatus(task)).stage).toBe("buyer_journaled");
  expect(await resumeOperatorTask(task, recover as never)).toEqual({ status: "not_found_uncertain", payment: { state: "unconfirmed" }, localResult: { state: "unchanged" }, localObservation: "saved" });
  expect(recover).toHaveBeenCalledWith(join(task, "buyer"));
  const observed = await operatorTaskStatus(task);
  expect(observed.lastObservation?.status).toBe("not_found_uncertain");
  expect(observed.lastObservation?.payment).toBe("unconfirmed");
  expect(observed.payment).toBe("unknown");
  expect(JSON.stringify(observed)).not.toContain(request.question);
  await writeFile(join(task, "request.json"), JSON.stringify({ ...request, question: "changed" }));
  await expect(resumeOperatorTask(task, recover as never)).rejects.toThrow("mismatch");
  expect(recover).toHaveBeenCalledTimes(1);
});

it("refuses an oversized serialized task before creating a directory", async () => {
  const { task } = await fixture();
  const oversized = { ...request, question: `Why?${"\u0000".repeat(1400)}` };
  await expect(createLegacyOperatorTask(task, { request: oversized, payee, maxTotalMicros: "100000" })).rejects.toThrow("8 KB");
  await expect(operatorTaskStatus(task)).rejects.toThrow();
});

it("round trips valid Unicode and rejects a linked buyer symlink", async () => {
  const { root, task } = await fixture();
  const unicode = { ...request, question: "Việt Nam nghiên cứu Arc — nguồn nào?" };
  await createLegacyOperatorTask(task, { request: unicode, payee, maxTotalMicros: "100000" });
  expect(JSON.parse(await readFile(join(task, "request.json"), "utf8"))).toEqual(unicode);
  await mkdir(join(root, "foreign"));
  await symlink(join(root, "foreign"), join(task, "buyer"), process.platform === "win32" ? "junction" : "dir");
  await expect(operatorTaskStatus(task)).rejects.toThrow("direct directory");
});

it.each([
  { name: "different request", override: { request: { ...request, question: "Different research" } } },
  { name: "different payee", override: { payee: otherPayee } },
  { name: "excess price", override: { amount: "110000" } },
])("refuses $name journal without recovery", async ({ override }) => {
  const { task } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" });
  await buyerJournal(task, override);
  const recover = vi.fn();
  await expect(resumeOperatorTask(task, recover as never)).rejects.toThrow("does not match");
  expect(recover).not.toHaveBeenCalled();
});

it("retains an interrupted buyer directory as incomplete, without inferring failed payment", async () => {
  const { task } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" });
  await mkdir(join(task, "buyer"));
  const status = await operatorTaskStatus(task);
  expect(status.stage).toBe("journal_incomplete");
  expect(status.payment).toBe("unknown");
  await expect(resumeOperatorTask(task, vi.fn() as never)).rejects.toThrow("No complete buyer journal");
});

async function completedRecovery(task: string, answer: string, citations: unknown[] = []) {
  const intent = await readBuyerJournal(join(task, "buyer"));
  const job = { queryId: intent.queryId, status: "completed", answer, researchPackage: a2aResearchPackage("quick"),
    pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03,
      settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005, unusedCreatorReserveUsdc: 0.015 } };
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: { id: intent.queryId, question: request.question, answer, answerSha256: sha256(answer),
      budgetUsdc: request.budget, researchMode: "quick" },
    citations, settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01,
      pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 } };
  const digest = researchReceiptDigest(payload);
  const receipt = { payload, integrity: { algorithm: "sha256", canonicalization: RESEARCH_RECEIPT_CANONICALIZATION,
    scope: "payload", digest } };
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(job))
    .mockResolvedValueOnce(Response.json(receipt, { headers: { "x-keryx-receipt-digest": digest } }));
  const result = await resumeOperatorTask(task, buyer => resumeResearch(buyer, http));
  expect(http).toHaveBeenCalledTimes(2);
  expect(http.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  return result;
}

it("saves only a completed verified answer, reopens it offline, and exports a private brief", async () => {
  const { task } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" }); await buyerJournal(task);
  const completed = await completedRecovery(task, "Arc answer with [1]", [{ marker: "[1]", sourceName: "Creator source" }]);
  expect(completed.localResult.state).toBe("saved");
  const status = await operatorTaskStatus(task);
  expect(status.payment).toBe("unknown"); expect(status.delivery).toBe("unknown");
  expect(status.savedResult).toBe("present_unchecked");
  const offline = await readOperatorResult(task);
  expect(offline?.answer).toBe("Arc answer with [1]");
  expect(offline?.citations).toEqual([{ marker: "[1]", sourceName: "Creator source" }]);
  const brief = formatOperatorBrief(offline!);
  expect(brief).toContain("Creator source"); expect(brief).toContain("private research");
  expect(brief).not.toContain((await readBuyerJournal(join(task, "buyer"))).queryId);
  expect(brief).not.toContain(payee);
});

it("rejects edited answer, receipt, task binding, and oversized saved files", async () => {
  const { task } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" }); await buyerJournal(task);
  await completedRecovery(task, "Original answer");
  const resultFile = join(task, "result.json");
  const original = await readFile(resultFile, "utf8");
  const snapshot = JSON.parse(original);
  snapshot.job.answer = "Edited answer";
  await writeFile(resultFile, JSON.stringify(snapshot));
  await expect(readOperatorResult(task)).rejects.toThrow();
  await writeFile(resultFile, original);
  const receiptFile = join(task, "buyer", snapshot.receiptFile);
  const receipt = await readFile(receiptFile, "utf8");
  await writeFile(receiptFile, receipt.replace("Original answer", "Edited answer"));
  await expect(readOperatorResult(task)).rejects.toThrow();
  await writeFile(receiptFile, receipt);
  await writeFile(join(task, "request.json"), JSON.stringify({ ...request, question: "Changed question" }));
  await expect(readOperatorResult(task)).rejects.toThrow(/mismatch/);
  await writeFile(join(task, "request.json"), JSON.stringify(request));
  await writeFile(resultFile, Buffer.alloc(150001, 65));
  expect((await operatorTaskStatus(task)).savedResult).toBe("invalid");
  await expect(readOperatorResult(task)).rejects.toThrow(/invalid/);
});

it("preserves a previous result across incomplete and failed checks, then replaces it after a later verified check", async () => {
  const { task } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" }); await buyerJournal(task);
  await completedRecovery(task, "First answer");
  const prior = await readFile(join(task, "result.json"), "utf8");
  await resumeOperatorTask(task, vi.fn(async () => ({ status: "not_found_uncertain" as const,
    payment: { state: "unconfirmed" as const } })) as never);
  expect(await readFile(join(task, "result.json"), "utf8")).toBe(prior);
  await expect(resumeOperatorTask(task, vi.fn(async () => { throw new Error("network down"); }) as never)).rejects.toThrow("network down");
  expect((await readOperatorResult(task))?.answer).toBe("First answer");
  await completedRecovery(task, "Second answer");
  expect((await readOperatorResult(task))?.answer).toBe("Second answer");
});

it("does not save a completed result without a verified receipt and preserves an older snapshot", async () => {
  const { task } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" }); await buyerJournal(task);
  await completedRecovery(task, "Prior verified answer");
  const before = await readFile(join(task, "result.json"), "utf8");
  const intent = await readBuyerJournal(join(task, "buyer"));
  const incomplete = { queryId: intent.queryId, status: "completed" as const, answer: "Unsupported answer",
    payment: { state: "unconfirmed" as const }, pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02,
      creatorBudgetUsdc: 0.03, settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005,
      unusedCreatorReserveUsdc: 0.015 },
    verification: { integrity: "verified" as const, requestBinding: "verified" as const,
      settlement: { mode: "real" as const, ledgerCompleteness: "complete" as const,
        settledCreatorUsdc: 0.01, pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 as const } } };
  const checked = await resumeOperatorTask(task, vi.fn(async () => incomplete) as never);
  expect(checked.localResult.state).toBe("save_failed");
  expect(await readFile(join(task, "result.json"), "utf8")).toBe(before);
  expect((await readOperatorResult(task))?.answer).toBe("Prior verified answer");
});

it("CLI exports each requested format to --file and preserves overwrite refusal", async () => {
  const { task, root } = await fixture();
  await createLegacyOperatorTask(task, { request, payee, maxTotalMicros: "100000" });
  await buyerJournal(task);
  await completedRecovery(task, "Saved answer", [{ marker: "S1", sourceId: "source", sourceName: "Creator",
    itemTitle: "Recorded article", itemUrl: "https://example.org/article", itemId: "item", contentVersion: "v1",
    weight: 1, rewardPlannedUsdc: 0.01, rationale: "read" }]);
  const raw = await readOperatorResult(task);
  const enriched = await readOperatorResearchResult(task);
  expect(raw).not.toHaveProperty("researchExports");
  expect(formatOperatorBrief(raw!)).not.toContain("## Recorded research exports");
  expect(enriched).toEqual({ ...raw, researchExports: enriched!.researchExports });
  expect(enriched!.researchExports.bibtex.count).toBe(1);
  expect(enriched!.authority).toBe(raw!.authority);
  expect(enriched!.receiptDigest).toBe(raw!.receiptDigest);
  const execute = promisify(execFile);
  const command = ["--import", "tsx", resolve("scripts/operator.mts"), "brief", "--state", task];
  for (const [format, expected] of [["brief", "# Private research brief"], ["bibtex", "@misc"], ["ris", "TY  - WEB"], ["csl-json", '"type": "webpage"'], ["evidence-csv", "claim_index"]]) {
    const target = join(root, `requested-${format}.txt`);
    const args = [...command, "--file", target, ...(format === "brief" ? [] : ["--format", format])];
    await execute(process.execPath, args);
    expect(await readFile(target, "utf8")).toContain(expected);
    await expect(execute(process.execPath, args)).rejects.toThrow();
  }
  const invalid = join(root, "invalid.txt");
  await expect(execute(process.execPath, [...command, "--file", invalid, "--format", "invalid"])).rejects.toThrow();
  await expect(readFile(invalid)).rejects.toMatchObject({ code: "ENOENT" });
  const snapshot = JSON.parse(await readFile(join(task, "result.json"), "utf8"));
  await writeFile(join(task, "buyer", snapshot.receiptFile), "{}");
  await expect(readOperatorResult(task)).rejects.toThrow();
  await expect(readOperatorResearchResult(task)).rejects.toThrow();
}, 30000);

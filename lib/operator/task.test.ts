import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuyerJournal } from "../buyer/journal";
import { authorizationWithNonce, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "../buyer/protocol";
import { buyerJobId } from "../buyer/policy";
import { createOperatorTask, operatorTaskStatus, resumeOperatorTask } from "./task";

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

it("creates exactly one private task and keeps status/export free of research content and settlement claims", async () => {
  const { task } = await fixture();
  const attempts = await Promise.allSettled(Array.from({ length: 2 }, () => createOperatorTask(task,
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
  await createOperatorTask(task, { request, payee, maxTotalMicros: "100000" });
  await buyerJournal(task);
  const recover = vi.fn(async () => ({ status: "not_found_uncertain" as const,
    payment: { state: "unconfirmed" as const } }));
  expect((await operatorTaskStatus(task)).stage).toBe("buyer_journaled");
  expect(await resumeOperatorTask(task, recover as never)).toEqual({ status: "not_found_uncertain", payment: { state: "unconfirmed" } });
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
  await expect(createOperatorTask(task, { request: oversized, payee, maxTotalMicros: "100000" })).rejects.toThrow("8 KB");
  await expect(operatorTaskStatus(task)).rejects.toThrow();
});

it("round trips valid Unicode and rejects a linked buyer symlink", async () => {
  const { root, task } = await fixture();
  const unicode = { ...request, question: "Việt Nam nghiên cứu Arc — nguồn nào?" };
  await createOperatorTask(task, { request: unicode, payee, maxTotalMicros: "100000" });
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
  await createOperatorTask(task, { request, payee, maxTotalMicros: "100000" });
  await buyerJournal(task, override);
  const recover = vi.fn();
  await expect(resumeOperatorTask(task, recover as never)).rejects.toThrow("does not match");
  expect(recover).not.toHaveBeenCalled();
});

it("retains an interrupted buyer directory as incomplete, without inferring failed payment", async () => {
  const { task } = await fixture();
  await createOperatorTask(task, { request, payee, maxTotalMicros: "100000" });
  await mkdir(join(task, "buyer"));
  const status = await operatorTaskStatus(task);
  expect(status.stage).toBe("journal_incomplete");
  expect(status.payment).toBe("unknown");
  await expect(resumeOperatorTask(task, vi.fn() as never)).rejects.toThrow("No complete buyer journal");
});

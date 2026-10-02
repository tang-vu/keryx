import { randomUUID } from "node:crypto";
import { open, lstat, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { buyerIntentSchemaForProfile, writeBuyerFile } from "../buyer/journal";
import { resumeResearch } from "../buyer/client";
import { buildBuyerReport } from "../buyer/report";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { addressSchema, buyerRequestSchema, BUYER_NETWORK, type BuyerRequest } from "../buyer/protocol";
import { inspectSavedOperatorResult, readSavedOperatorResult, readSavedOperatorResearchResult, saveVerifiedOperatorResult } from "./result";
import { type NativeTaskWriter } from "./native-task-writer";
export { privateOperatorBrief as formatOperatorBrief, formatOperatorResearchExport } from "./result";

const legacyTaskSchema = z.object({
  schema: z.literal("keryx-operator-task-v1"),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  kind: z.literal("paid_research"),
  request: buyerRequestSchema,
  payee: addressSchema,
  maxTotalMicros: z.string().regex(/^[1-9]\d{0,6}$/),
}).strict();
const taskSchema = z.union([legacyTaskSchema, legacyTaskSchema.extend({ schema: z.literal("keryx-operator-task-v2"), network: z.enum(["eip155:5042", "eip155:5042002"]) })]);
type Task = z.infer<typeof taskSchema>;
const taskNetwork = (task: Task) => task.schema === "keryx-operator-task-v2" ? task.network : "eip155:5042002";
const MAX_TASK_FILE_BYTES = 8192;

function validateCap(request: BuyerRequest, maxTotalMicros: string) {
  const micros = BigInt(maxTotalMicros);
  if (micros > BigInt(1_000_000) || micros <= BigInt(Math.round(request.budget * 1e6))) {
    throw new Error("Total cap must exceed the creator budget and be at most 1 USDC");
  }
}

async function readBoundedJson(path: string, maxBytes = MAX_TASK_FILE_BYTES) {
  const pathStat = await lstat(path);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error("Task file must be regular");
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error("Task file must be regular");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error("Task file exceeds its size limit");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await file.close(); }
}

/** One native authority creates immutable v1 bytes. Existing readers retain their legacy policy. */
export async function createOperatorTask(directory: string, input: { request: unknown; payee: string; maxTotalMicros: string },
  writer: NativeTaskWriter) {
  const target = resolve(directory);
  const id = randomUUID();
  const created = await writer.create({ parent: dirname(target), child: basename(target), request: input.request,
    payee: input.payee, maxTotalMicros: input.maxTotalMicros, id, createdAt: new Date().toISOString(), network: BUYER_NETWORK });
  return { taskId: created.taskId, status: "ready" as const, buyerState: join(target, "buyer"),
    publicationState: created.state };
}

async function readTask(directory: string): Promise<Task> {
  const target = resolve(directory);
  const task = taskSchema.parse(await readBoundedJson(join(target, "task.json")));
  const request = buyerRequestSchema.parse(await readBoundedJson(join(target, "request.json")));
  if (JSON.stringify(task.request) !== JSON.stringify(request)) throw new Error("Task request file mismatch");
  validateCap(task.request, task.maxTotalMicros);
  return task;
}

async function linkedBuyerState(directory: string, task: Task) {
  const buyer = join(resolve(directory), "buyer");
  try { if (!(await lstat(buyer)).isDirectory()) throw new Error("Buyer state must be a direct directory"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { buyer, stage: "ready" as const };
    throw error;
  }
  let intent;
  try { intent = buyerIntentSchemaForProfile(taskNetwork(task) === "eip155:5042" ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE).parse(await readBoundedJson(join(buyer, "intent.json"), 65_536)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Distinguish a buyer process that created its directory from a vanished directory.
      if (!(await lstat(buyer)).isDirectory()) throw new Error("Buyer state must be a direct directory");
      return { buyer, stage: "journal_incomplete" as const };
    }
    throw error;
  }
  if (JSON.stringify(intent.request) !== JSON.stringify(task.request)
    || intent.requirement.network !== taskNetwork(task)
    || intent.requirement.payTo.toLowerCase() !== task.payee.toLowerCase()
    || BigInt(intent.requirement.amount) > BigInt(task.maxTotalMicros)) {
    throw new Error("Buyer journal does not match the original task request and limits");
  }
  return { buyer, stage: "buyer_journaled" as const, queryId: intent.queryId };
}

/** Local status and export cannot claim delivery or settlement. */
export async function operatorTaskStatus(directory: string) {
  const task = await readTask(directory);
  const linked = await linkedBuyerState(directory, task);
  const observation = linked.stage === "buyer_journaled" ? await readObservation(directory, task.id, linked.queryId) : null;
  const savedResult = await inspectSavedOperatorResult(directory);
  return { schema: "keryx-operator-task-status-v1" as const, taskId: task.id,
    createdAt: task.createdAt, kind: task.kind, network: taskNetwork(task), stage: linked.stage,
    buyerJobId: "queryId" in linked ? linked.queryId : null,
    creatorBudgetMicros: Math.round(task.request.budget * 1e6), maxTotalMicros: task.maxTotalMicros,
    payment: "unknown" as const, delivery: "unknown" as const, lastObservation: observation, savedResult,
    authority: "Local journal state only; use resume for verified remote delivery and reported payment evidence" };
}

async function readObservation(directory: string, taskId: string, buyerJobId: string) {
  let value: unknown;
  try { value = await readBoundedJson(join(resolve(directory), "last-observation.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const observation = z.object({ schema: z.literal("keryx-operator-observation-v1"), taskId: z.literal(taskId),
    buyerJobId: z.literal(buyerJobId), observedAt: z.string().datetime(), report: z.object({
      schema: z.literal("keryx-buyer-report-v1"),
      status: z.enum(["queued", "processing", "review_required", "completed", "failed", "not_found_uncertain"]),
      payment: z.object({ state: z.enum(["seller_reported_settled", "unconfirmed"]) }),
      accountingAgreement: z.enum(["matches", "differs", "unavailable"]),
    }) }).strict().parse(value);
  return { observedAt: observation.observedAt,
    status: observation.report.status, payment: observation.report.payment.state,
    accountingAgreement: observation.report.accountingAgreement,
    authority: "Last local GET observation; may be stale. Payment evidence and creator settlement remain seller-reported." };
}

async function saveObservation(directory: string, taskId: string, buyerJobId: string, report: unknown) {
  const target = resolve(directory);
  const temporary = `.observation-${randomUUID()}.tmp`;
  const value = { schema: "keryx-operator-observation-v1", taskId, buyerJobId,
    observedAt: new Date().toISOString(), report };
  if (Buffer.byteLength(JSON.stringify(value, null, 2) + "\n") > MAX_TASK_FILE_BYTES) throw new Error("Observation exceeds 8 KB");
  try {
    await writeBuyerFile(target, temporary, value);
    await rename(join(target, temporary), join(target, "last-observation.json"));
    if (process.platform !== "win32") {
      const parent = await open(target, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await unlink(join(target, temporary)).catch(() => undefined); }
}

/** Recovery delegates to the existing GET-only buyer path after exact task binding. */
export async function resumeOperatorTask(directory: string, recover: typeof resumeResearch = resumeResearch) {
  const task = await readTask(directory);
  if (taskNetwork(task) !== BUYER_NETWORK) throw new Error("Task belongs to a different network; preserve its original files and recover with its original configuration");
  const linked = await linkedBuyerState(directory, task);
  if (linked.stage !== "buyer_journaled") throw new Error("No complete buyer journal; inspect the original task before recovery");
  const result = await recover(linked.buyer);
  const report = buildBuyerReport(result);
  let localResult: { state: "saved" | "save_failed" | "unchanged"; message?: string } = { state: "unchanged" };
  if (report.status === "completed") {
    try {
      await saveVerifiedOperatorResult(directory, { taskId: task.id, request: task.request, buyer: linked.buyer,
        buyerJobId: linked.queryId, network: taskNetwork(task) }, result);
      localResult = { state: "saved" };
    } catch {
      localResult = { state: "save_failed", message: "Completed remote result could not be saved locally. Keep the original buyer receipt and retry GET-only recovery; do not repurchase." };
    }
  }
  let localObservation: "saved" | "save_failed" = "saved";
  try {
    await saveObservation(directory, task.id, linked.queryId, { schema: report.schema,
      status: report.status, payment: report.payment, accountingAgreement: report.accountingAgreement });
  } catch { localObservation = "save_failed"; }
  return { ...result, localResult, localObservation };
}

/** Private offline read; rechecks saved bytes and original task/journal binding. */
async function savedResultContext(directory: string) {
  const task = await readTask(directory);
  const saved = await inspectSavedOperatorResult(directory);
  if (saved === "absent") return null;
  if (saved === "invalid") throw new Error("Saved result file is invalid; keep the original buyer receipt for recovery");
  const linked = await linkedBuyerState(directory, task);
  if (linked.stage !== "buyer_journaled") throw new Error("Saved result has no matching buyer journal");
  return { taskId: task.id, request: task.request, buyer: linked.buyer, buyerJobId: linked.queryId, network: taskNetwork(task) };
}

export async function readOperatorResult(directory: string) {
  const context = await savedResultContext(directory);
  return context ? readSavedOperatorResult(directory, context) : null;
}

/** Explicit application enrichment above the stable TypeScript/native inspection contract. */
export async function readOperatorResearchResult(directory: string) {
  const context = await savedResultContext(directory);
  return context ? readSavedOperatorResearchResult(directory, context) : null;
}

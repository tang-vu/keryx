import { bibliographyExportsFromCheckedReceipt, exportsFromCheckedReceipt } from "../research/receipt-exports";
import { open, lstat, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";
import { buyerJobSchema } from "../a2a/buyer-workspace";
import { buyerIntentSchemaForProfile, writeBuyerFile } from "../buyer/journal";
import { verifyBuyerJob, verifyBuyerReceipt } from "../buyer/verify-result";
import type { BuyerRequest } from "../buyer/protocol";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { sha256 } from "../research-receipt-integrity";
import { checkedBibliographyExportErrors } from "../../locales/en/checked-bibliography-exports";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const snapshotSchema = z.object({
  schema: z.literal("keryx-operator-result-v1"), taskId: z.string().uuid(),
  buyerJobId: z.string().regex(/^a2a_[a-f0-9]{64}$/), savedAt: z.string().datetime(),
  receiptDigest: z.string().regex(DIGEST), receiptFile: z.string().regex(/^receipt-[a-f0-9]{64}\.json$/),
  answerSha256: z.string().regex(DIGEST), packageFingerprint: z.string().min(1).max(256),
  paymentAtCheck: z.enum(["seller_reported_settled", "unconfirmed"]),
  job: buyerJobSchema,
}).strict();
const MAX_SNAPSHOT_BYTES = 150_000;
const MAX_RECEIPT_BYTES = 2_000_000;
type Context = { taskId: string; request: BuyerRequest; buyer: string; buyerJobId: string; network?: "eip155:5042" | "eip155:5042002" };

async function boundedRegular(path: string, max: number) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Local result file must be regular");
  const file = await open(path, "r");
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > max) throw new Error("Local result file exceeds its size limit");
    const bytes = Buffer.alloc(max + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > max) throw new Error("Local result file exceeds its size limit");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await file.close(); }
}

async function checkedDirectories(directory: string, buyer: string) {
  const task = resolve(directory);
  const taskStat = await lstat(task);
  const buyerStat = await lstat(buyer);
  if (!taskStat.isDirectory() || taskStat.isSymbolicLink() || !buyerStat.isDirectory() || buyerStat.isSymbolicLink()
    || await realpath(task) !== task || resolve(buyer) !== join(task, "buyer")
    || await realpath(buyer) !== join(task, "buyer")) {
    throw new Error("Local result directory is not the original task/buyer directory");
  }
  return task;
}

async function contextIntent(context: Context) {
  const intentPath = join(context.buyer, "intent.json");
  const intent = buyerIntentSchemaForProfile(context.network === "eip155:5042" ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE).parse(JSON.parse(await boundedRegular(intentPath, 65_536)));
  if (intent.queryId !== context.buyerJobId || JSON.stringify(intent.request) !== JSON.stringify(context.request)) {
    throw new Error("Local result no longer matches the buyer journal");
  }
  return intent;
}

function citationsFromReceipt(receipt: unknown) {
  const payload = z.object({ payload: z.object({ citations: z.array(z.unknown()).optional() }).passthrough() }).passthrough().parse(receipt);
  const citationSchema = z.object({ marker: z.string().max(64), sourceName: z.string().max(256) });
  return (payload.payload.citations ?? []).slice(0, 64).flatMap(value => {
    const parsed = citationSchema.safeParse(value);
    return parsed.success ? [{ marker: parsed.data.marker, sourceName: parsed.data.sourceName }] : [];
  });
}

/** A saved digest can recheck local bytes, but cannot replay the original HTTPS channel. */
async function validateSnapshot(directory: string, context: Context, raw: unknown) {
  const snapshot = snapshotSchema.parse(raw);
  if (snapshot.taskId !== context.taskId || snapshot.buyerJobId !== context.buyerJobId
    || snapshot.receiptFile !== `receipt-${snapshot.receiptDigest.slice(7)}.json`) {
    throw new Error("Saved result does not match this task and receipt");
  }
  const intent = await contextIntent(context);
  const receipt = JSON.parse(await boundedRegular(join(context.buyer, snapshot.receiptFile), MAX_RECEIPT_BYTES));
  const packageDefinition = a2aResearchPackageForVersion(intent.request.researchMode, intent.request.packageVersion);
  if (!packageDefinition) throw new Error("Unsupported research package");
  const job = { ...snapshot.job, researchPackage: packageDefinition };
  const { packageFingerprint } = verifyBuyerJob(job, intent);
  if (snapshot.job.status !== "completed" || packageFingerprint !== snapshot.packageFingerprint
    || typeof snapshot.job.answer !== "string" || sha256(snapshot.job.answer) !== snapshot.answerSha256) {
    throw new Error("Saved result answer or package differs from the verified request");
  }
  const verification = verifyBuyerReceipt(receipt, snapshot.receiptDigest, intent, snapshot.job.answer);
  if (verification.digest !== snapshot.receiptDigest) throw new Error("Saved receipt digest differs");
  const result = { savedAt: snapshot.savedAt, answer: snapshot.job.answer, question: intent.request.question,
    citations: citationsFromReceipt(receipt), paymentAtCheck: snapshot.paymentAtCheck,
    receiptDigest: snapshot.receiptDigest,
    authority: "Local files rechecked against the original task and saved receipt. The original HTTPS digest observation cannot be reauthenticated offline; payment and creator settlement remain seller-reported." };
  return { result, receipt };
}

async function readCheckedSnapshot(directory: string, context: Context) {
  const task = await checkedDirectories(directory, context.buyer);
  let text: string;
  try { text = await boundedRegular(join(task, "result.json"), MAX_SNAPSHOT_BYTES); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  return validateSnapshot(task, context, JSON.parse(text));
}

/** Stable v1 inspection domain shared with the evaluated native reader. */
export async function readSavedOperatorResult(directory: string, context: Context) {
  const checked = await readCheckedSnapshot(directory, context);
  return checked?.result ?? null;
}

/** Application export projection; uses the exact receipt bytes checked above, never a reread.
 * This TypeScript-owned presentation domain does not change native inspection authority. */
export async function readSavedOperatorResearchResult(directory: string, context: Context) {
  const checked = await readCheckedSnapshot(directory, context);
  if (!checked) return null;
  const bibliographyExports = bibliographyExportsFromCheckedReceipt(checked.receipt);
  return { ...checked.result, researchExports: exportsFromCheckedReceipt(checked.receipt),
    ...(bibliographyExports ? { bibliographyExports } : {}) };
}

export async function inspectSavedOperatorResult(directory: string) {
  try {
    const stat = await lstat(join(resolve(directory), "result.json"));
    return stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_SNAPSHOT_BYTES
      ? "present_unchecked" as const : "invalid" as const;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent" as const; throw error; }
}

/** Called only after the existing GET recovery returned a completed verified receipt. */
export async function saveVerifiedOperatorResult(directory: string, context: Context, result: unknown) {
  const task = await checkedDirectories(directory, context.buyer);
  const parsed = z.object({ status: z.literal("completed"), receiptFile: z.string(),
    packageFingerprint: z.string(), payment: z.object({ state: z.enum(["seller_reported_settled", "unconfirmed"]) }),
    verification: z.object({ integrity: z.literal("verified"), requestBinding: z.literal("verified"),
      digest: z.string().regex(DIGEST) }) }).passthrough().parse(result);
  const job = buyerJobSchema.parse(result);
  const value = snapshotSchema.parse({ schema: "keryx-operator-result-v1", taskId: context.taskId,
    buyerJobId: context.buyerJobId, savedAt: new Date().toISOString(), receiptDigest: parsed.verification.digest,
    receiptFile: parsed.receiptFile, answerSha256: sha256(job.answer!), packageFingerprint: parsed.packageFingerprint,
    paymentAtCheck: parsed.payment.state, job });
  await validateSnapshot(task, context, value);
  const serialized = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES) throw new Error("Completed result is too large to save locally");
  const temporary = `.result-${randomUUID()}.tmp`;
  try {
    await writeBuyerFile(task, temporary, value);
    await rename(join(task, temporary), join(task, "result.json"));
    if (process.platform !== "win32") {
      const parent = await open(task, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await unlink(join(task, temporary)).catch(() => undefined); }
}

function markdownText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replace(/([`*_{}\[\]()#!|])/g, "\\$1")
    .replace(/(https?):\/\//gi, "$1\\://");
}

function inertAnswer(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n").map(line => `    ${line}`).join("\n");
}

export function privateOperatorBrief(result: NonNullable<Awaited<ReturnType<typeof readSavedOperatorResult>>>) {
  const lines = ["# Private research brief", "", `Question: ${markdownText(result.question)}`, "",
    `Saved local check: ${result.savedAt}`, "",
    "This brief contains private research. Local receipt integrity and task binding were rechecked. The original HTTPS observation cannot be reauthenticated offline. Payment and creator settlement remain seller-reported; this is not independent settlement or factual proof.",
    "", "## Answer", "", inertAnswer(result.answer), ""];
  if (result.citations.length) {
    lines.push("## Cited sources in saved receipt", "");
    for (const citation of result.citations) lines.push(`- ${markdownText(citation.marker)} ${markdownText(citation.sourceName)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export const operatorResearchExportFormat = z.enum(["brief", "bibtex", "ris", "csl-json", "evidence-csv",
  "bibliography-bibtex", "bibliography-ris", "bibliography-csl-json"]);
export type OperatorResearchExportFormat = z.infer<typeof operatorResearchExportFormat>;

export function formatOperatorResearchExport(result: NonNullable<Awaited<ReturnType<typeof readSavedOperatorResult>>> | NonNullable<Awaited<ReturnType<typeof readSavedOperatorResearchResult>>>, format: unknown = "brief") {
  const selected = operatorResearchExportFormat.parse(format);
  if (selected === "brief") return privateOperatorBrief(result);
  if (selected === "bibliography-bibtex" || selected === "bibliography-ris" || selected === "bibliography-csl-json") {
    if (!("bibliographyExports" in result) || !result.bibliographyExports?.bibtex.count)
      throw new Error(checkedBibliographyExportErrors.unavailable);
    if (selected === "bibliography-csl-json") return result.bibliographyExports.cslJson.content;
    return result.bibliographyExports[selected === "bibliography-bibtex" ? "bibtex" : "ris"].content;
  }
  if (!("researchExports" in result)) throw new Error("Research export requires the checked application projection");
  if (selected === "evidence-csv") return result.researchExports.evidenceCsv;
  if (selected === "csl-json") return result.researchExports.cslJson.content;
  return result.researchExports[selected].content;
}

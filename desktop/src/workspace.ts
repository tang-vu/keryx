import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { formatOperatorResearchExport, operatorTaskStatus, readOperatorResult, readOperatorResearchResult, resumeOperatorTask } from "../../lib/operator/task";
import { addressSchema, buyerRequestSchema } from "../../lib/buyer/protocol";
import { parseBuyerBudget } from "../../lib/a2a/buyer-workspace";
import type { CreateInput, CreatedTaskRow, ReferenceRow, TaskRow, WorkspaceView } from "./contracts";

const handleSchema = z.string().regex(/^ref-[0-9a-f-]{36}$/);
const createSchema = z.object({ question: z.string(), mode: z.enum(["quick", "deep"]),
  creatorBudget: z.string().max(24), payee: addressSchema, totalCap: z.string().max(24), network: z.enum(["arc", "arcTestnet"]).optional() }).strict();
const referenceSchema = z.object({ schema: z.literal("keryx-local-reference-v1"), handle: handleSchema,
  name: z.string().min(1).max(255), importedAt: z.string().datetime(), bytes: z.number().int().min(1).max(262144),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const MAX_REFERENCE_BYTES = 262144;
const MAX_WORKSPACE_CHILDREN = 1000;

async function boundedFile(path: string, max: number): Promise<Buffer> {
  if (!(await lstat(path)).isFile()) throw new Error("Expected a regular file");
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error("Expected a regular file");
    const data = Buffer.alloc(max + 1);
    let count = 0;
    while (count < data.length) {
      const { bytesRead } = await file.read(data, count, data.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > max) throw new Error("File is too large");
    return data.subarray(0, count);
  } finally { await file.close(); }
}

async function safeChild(parent: string, name: string, kind: "directory" | "file") {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) throw new Error("Invalid item handle");
  const child = join(parent, name);
  const stat = await lstat(child);
  if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) throw new Error("Invalid workspace item");
  const actual = await realpath(child);
  const parentActual = await realpath(parent);
  if (!actual.startsWith(parentActual + sep)) throw new Error("Workspace item escapes its parent");
  return actual;
}

export function parseMicros(value: string, max: number) {
  const parsed = parseBuyerBudget(value, max);
  if (parsed === null) throw new Error("Enter a USDC amount with at most six decimals");
  return String(Math.round(parsed * 1e6));
}

/** The desktop receives one trusted writer from its main process; readers remain compatible with v1 tasks. */
export interface DesktopTaskWriter {
  create(input: { parent: string; child: string; request: unknown; payee: string;
    maxTotalMicros: string; id: string; createdAt: string; network?: "eip155:5042" | "eip155:5042002" }): Promise<{ taskId: string; child: string; state: "unix_synced" | "windows_visible_entry_unproven" }>;
  createWorkspace(parent: string, child: string): Promise<{ child: string; state: "unix_synced" | "windows_visible_entry_unproven" }>;
}

// The outcome and recovery instruction precede the path so the helper wire bound on error
// strings can only truncate trailing detail, never the "do not retry" guidance.
export function creationError(error: unknown, path: string): Error {
  const state = error && typeof error === "object" && "state" in error ? error.state : undefined;
  const stage = error && typeof error === "object" && "stage" in error ? error.stage : undefined;
  if (state === "retained_partial" || state === "complete_unconfirmed" || state === "unknown") {
    return new Error(`Creation could not be confirmed. Do not retry at the same location; keep this path for inspection: ${path}`);
  }
  if (state === "refused_unchanged" && stage === "artifact") {
    return new Error("The trusted task writer is missing or its files changed. Reinstall this desktop release before creating new items.");
  }
  if (state === "refused_unchanged" && stage === "protocol") {
    return new Error("This desktop release cannot use its task writer version. Reinstall the current release before creating new items.");
  }
  if (state === "refused_unchanged" && stage === "prepare") {
    const reason = error && typeof error === "object" && "reason" in error ? error.reason : undefined;
    return new Error(typeof reason === "string" ? reason : "The task budget or request is outside the accepted range.");
  }
  if (state === "refused_unchanged" && stage === "mkdir") {
    return new Error("A folder with that name already exists or cannot be created. Check the selected location before trying again.");
  }
  if (state === "refused_unchanged") {
    return new Error(`This folder or Windows account cannot safely create a private Operator item here. Choose a folder you own or use a standard Windows account. No new item was created.`);
  }
  return new Error(`The trusted task writer is unavailable or could not be verified. Reinstall this desktop release before creating a new item. ${error instanceof Error ? error.message : ""}`.trim());
}

export class WorkspaceStore {
  constructor(private readonly writer: DesktopTaskWriter) {}
  private path: string | null = null;
  private creationPath: string | null = null;
  private identity: { dev: number; ino: number } | null = null;
  private readonly taskHandles = new Map<string, string>();
  private readonly directoryHandles = new Map<string, string>();

  get selectedPath() { return this.creationPath; }

  async select(path: string) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Choose a regular workspace directory");
    const lexical = resolve(path);
    const canonical = await realpath(path);
    const selectedStat = lstatSync(canonical);
    this.creationPath = lexical;
    this.path = canonical;
    this.identity = { dev: selectedStat.dev, ino: selectedStat.ino };
    this.taskHandles.clear();
    this.directoryHandles.clear();
    return this.view();
  }

  async create(parent: string) {
    const stat = await lstat(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Choose a regular parent directory");
    const selectedParent = resolve(parent);
    const child = `Keryx-Operator-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const target = join(selectedParent, child);
    let state: "unix_synced" | "windows_visible_entry_unproven";
    try {
      const result = await this.writer.createWorkspace(selectedParent, child);
      if (result.child !== child) throw { state: "complete_unconfirmed" };
      state = result.state;
    } catch (error) { throw creationError(error, target); }
    try { return { ...await this.select(target), creationState: state }; }
    catch { throw creationError({ state: "complete_unconfirmed" }, target); }
  }

  private selected() {
    if (!this.path || !this.creationPath) throw new Error("Choose a workspace first");
    const stat = lstatSync(this.path);
    const selectedEntry = lstatSync(this.creationPath);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(this.path) !== this.path
      || selectedEntry.isSymbolicLink() || !selectedEntry.isDirectory()
      || (this.identity && (selectedEntry.dev !== this.identity.dev || selectedEntry.ino !== this.identity.ino))
      || (this.identity && (stat.dev !== this.identity.dev || stat.ino !== this.identity.ino))) {
      throw new Error("The selected workspace has changed; reopen it before continuing");
    }
    return this.path;
  }

  async view(): Promise<WorkspaceView> {
    const root = this.selected();
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length > MAX_WORKSPACE_CHILDREN) throw new Error("Workspace contains too many items");
    const tasks: TaskRow[] = [];
    let invalidDirectories = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === "references") continue;
      try {
        const directory = await safeChild(root, entry.name, "directory");
        tasks.push(await this.readTask(entry.name, directory));
      } catch { invalidDirectories++; }
    }
    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { name: basename(root), path: root, tasks, references: await this.references(), invalidDirectories };
  }

  private async readTask(directoryName: string, directory: string): Promise<TaskRow> {
    await safeChild(directory, "task.json", "file");
    await safeChild(directory, "request.json", "file");
    // The shared buyer journal reader checks its size after readFile; bound it before delegating.
    try {
      const buyer = await safeChild(directory, "buyer", "directory");
      const intent = await safeChild(buyer, "intent.json", "file");
      if ((await lstat(intent)).size > 65536) throw new Error("Buyer journal is too large");
      try {
        const paymentResponse = await safeChild(buyer, "payment-response.json", "file");
        if ((await lstat(paymentResponse)).size > 65536) throw new Error("Buyer acknowledgement is too large");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      const observation = await safeChild(directory, "last-observation.json", "file");
      if ((await lstat(observation)).size > 8192) throw new Error("Observation is too large");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const status = await operatorTaskStatus(directory);
    const request = buyerRequestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedFile(join(directory, "request.json"), 8192))));
    const task = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(join(directory, "task.json"), 8192)));
    const payee = addressSchema.parse(task.payee);
    let handle = this.directoryHandles.get(directoryName);
    if (!handle) {
      handle = randomUUID();
      this.directoryHandles.set(directoryName, handle);
      this.taskHandles.set(handle, directoryName);
    }
    return { handle, directoryName, question: request.question, mode: request.researchMode, payee, createdAt: status.createdAt, status };
  }

  private async taskPath(handle: string) {
    z.string().uuid().parse(handle);
    const directoryName = this.taskHandles.get(handle);
    if (!directoryName) throw new Error("Unknown task handle; refresh the workspace");
    return safeChild(this.selected(), directoryName, "directory");
  }

  async createTask(value: unknown): Promise<CreatedTaskRow> {
    const input = createSchema.parse(value) as CreateInput;
    const network = input.network === "arc" ? "eip155:5042" : "eip155:5042002";
    const creatorBudgetMicros = parseMicros(input.creatorBudget, 0.5);
    const totalMicros = parseMicros(input.totalCap, 1);
    const request = buyerRequestSchema.parse({ question: input.question, budget: Number(creatorBudgetMicros) / 1e6,
      researchMode: input.mode, packageVersion: "1.0.0", responseMode: "async" });
    const directoryName = `task-${randomUUID()}`;
    this.selected();
    const parent = this.creationPath!;
    const directory = join(parent, directoryName);
    const id = randomUUID();
    let state: "unix_synced" | "windows_visible_entry_unproven";
    try {
      const result = await this.writer.create({ parent, child: directoryName, request,
        payee: input.payee, maxTotalMicros: totalMicros, id, createdAt: new Date().toISOString(), network });
      if (result.child !== directoryName || result.taskId !== id) throw { state: "complete_unconfirmed" };
      state = result.state;
    } catch (error) { throw creationError(error, directory); }
    try { const task = await this.readTask(directoryName, directory);
      if (task.status.network !== network) throw new Error("Task network does not match selected preparation");
      return { ...task, publicationState: state }; }
    catch { throw creationError({ state: "complete_unconfirmed" }, directory); }
  }

  async refreshTask(handle: unknown) {
    if (typeof handle !== "string") throw new Error("Invalid task handle");
    const path = await this.taskPath(handle);
    return this.readTask(this.taskHandles.get(handle)!, path);
  }

  async resumeTask(handle: unknown): Promise<{ task: TaskRow; answer: string | null; answerTruncated: boolean; localResult: { state: string; message?: string }; localObservation: "saved" | "save_failed" }> {
    if (typeof handle !== "string") throw new Error("Invalid task handle");
    const path = await this.taskPath(handle);
    await this.readTask(this.taskHandles.get(handle)!, path);
    const result = await resumeOperatorTask(path);
    const task = await this.readTask(this.taskHandles.get(handle)!, path);
    const answer = "answer" in result && typeof result.answer === "string" ? result.answer.slice(0, 50_000) : null;
    return { task, answer, answerTruncated: "answer" in result && typeof result.answer === "string" && result.answer.length > 50_000,
      localResult: result.localResult, localObservation: result.localObservation };
  }

  async readResult(handle: unknown) {
    if (typeof handle !== "string") throw new Error("Invalid task handle");
    const path = await this.taskPath(handle);
    await this.readTask(this.taskHandles.get(handle)!, path);
    return readOperatorResult(path);
  }

  async exportBrief(handle: unknown, format: unknown = "brief") {
    if (typeof handle !== "string") throw new Error("Invalid task handle");
    const path = await this.taskPath(handle);
    await this.readTask(this.taskHandles.get(handle)!, path);
    const result = format === "brief" ? await readOperatorResult(path) : await readOperatorResearchResult(path);
    if (!result) throw new Error("No saved completed result; check the original job first");
    return formatOperatorResearchExport(result, format);
  }

  async exportTask(handle: unknown): Promise<string> {
    const task = await this.refreshTask(handle);
    return JSON.stringify(task.status, null, 2) + "\n";
  }

  async importReference(path: string): Promise<ReferenceRow> {
    const root = this.selected();
    const name = basename(path);
    if (![".txt", ".md", ".markdown"].includes(extname(name).toLowerCase())) throw new Error("Choose a text or Markdown file");
    const bytes = await boundedFile(path, MAX_REFERENCE_BYTES);
    if (bytes.length === 0) throw new Error("Reference is empty");
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const handle = `ref-${randomUUID()}`;
    const meta = referenceSchema.parse({ schema: "keryx-local-reference-v1", handle, name,
      importedAt: new Date().toISOString(), bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
    const library = join(root, "references");
    await mkdir(library, { mode: 0o700, recursive: true });
    await safeChild(root, "references", "directory");
    const snapshot = await open(join(library, `${handle}.txt`), "wx", 0o600);
    try { await snapshot.writeFile(bytes); await snapshot.sync(); } finally { await snapshot.close(); }
    const manifest = await open(join(library, `${handle}.json`), "wx", 0o600);
    try { await manifest.writeFile(JSON.stringify(meta, null, 2) + "\n"); await manifest.sync(); } finally { await manifest.close(); }
    return meta;
  }

  async references(): Promise<ReferenceRow[]> {
    const root = this.selected();
    let library: string;
    try { library = await safeChild(root, "references", "directory"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const names = await readdir(library);
    if (names.length > MAX_WORKSPACE_CHILDREN) throw new Error("Reference library contains too many items");
    const results: ReferenceRow[] = [];
    for (const name of names) {
      if (!/^ref-[0-9a-f-]{36}\.json$/.test(name)) continue;
      try {
        const parsed = referenceSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
          await boundedFile(await safeChild(library, name, "file"), 2048))));
        const snapshot = await boundedFile(await safeChild(library, `${parsed.handle}.txt`, "file"), MAX_REFERENCE_BYTES);
        if (snapshot.length !== parsed.bytes || createHash("sha256").update(snapshot).digest("hex") !== parsed.sha256) continue;
        results.push(parsed);
      } catch { /* Invalid local data cannot become a trusted reference row. */ }
    }
    return results.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }
}

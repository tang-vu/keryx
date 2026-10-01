import { open, writeFile } from "node:fs/promises";
import { createNativeTaskWriter } from "../../lib/operator/native-task-writer";
import { publishPrivateText } from "../../lib/operator/private-text-export";
import { WorkspaceStore } from "./workspace";
import { workspaceCreatedSelectionFailed } from "./helper-errors";
import { boundErrorMessage, encodeResponseFrame, MAX_REQUEST_FRAME, parseRequestFrame, type HelperRequest } from "./helper-protocol";

declare const KERYX_NATIVE_SOURCE_COMMIT: string;

type Init = { sourceCommit: string; nativeBinary: string; nativeManifest: string; selectionFile: string;
  legacySelectionFile: string | null };
let store: WorkspaceStore | undefined;
let selectionFile: string | undefined;
let legacySelectionFile: string | null = null;
let priorId = 0;

function payloadObject(payload: string): Record<string, unknown> {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid command arguments");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).sort().join(",") !== names.sort().join(",")) throw new Error("Invalid command arguments");
}

function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error("Invalid command argument");
  return value;
}

async function saveSelection() {
  if (!selectionFile || !store?.selectedPath) return;
  await writeFile(selectionFile, JSON.stringify({ path: store.selectedPath }), { mode: 0o600 });
}

async function loadSelectionFile(path: string): Promise<"missing" | "present"> {
  if (!store) return "missing";
  let file;
  try {
    file = await open(path, "r");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "present";
  }
  try {
    let data: string;
    try {
      const buffer = Buffer.alloc(4097);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > 4096) return "present";
      data = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    } finally { await file.close(); }
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === "object" && "path" in parsed && typeof parsed.path === "string") await store.select(parsed.path);
  } catch { /* A moved workspace returns to the chooser. */ }
  return "present";
}

async function loadSelection() {
  if (!selectionFile) return;
  if (await loadSelectionFile(selectionFile) === "missing" && legacySelectionFile) {
    await loadSelectionFile(legacySelectionFile);
    if (store?.selectedPath) await saveSelection();
  }
}

async function execute(request: HelperRequest): Promise<unknown> {
  const arg = payloadObject(request.payload);
  if (request.action === "init") {
    if (store) throw new Error("Helper already initialized");
    keys(arg, ["sourceCommit", "nativeBinary", "nativeManifest", "selectionFile", "legacySelectionFile"]);
    const init = arg as Init;
    if (string(init.sourceCommit, 40) !== KERYX_NATIVE_SOURCE_COMMIT || !/^[a-f0-9]{40}$/.test(init.sourceCommit)) {
      throw new Error("Packaged helper source identity mismatch");
    }
    selectionFile = string(init.selectionFile, 32767);
    legacySelectionFile = init.legacySelectionFile === null ? null : string(init.legacySelectionFile, 32767);
    store = new WorkspaceStore(createNativeTaskWriter({ binaryPath: string(init.nativeBinary, 32767),
      manifestPath: string(init.nativeManifest, 32767), expectedSourceCommit: init.sourceCommit }));
    await loadSelection();
    return { ready: true };
  }
  if (!store) throw new Error("Helper is not initialized");
  switch (request.action) {
    case "choose_workspace": {
      keys(arg, ["path"]);
      const result = await store.select(string(arg.path, 32767));
      await saveSelection();
      return result;
    }
    case "create_workspace": {
      keys(arg, ["parent"]);
      const result = await store.create(string(arg.parent, 32767));
      try { await saveSelection(); }
      catch { throw workspaceCreatedSelectionFailed(result.path); }
      return result;
    }
    case "refresh": keys(arg, []); return store.selectedPath ? store.view() : null;
    case "create_task": keys(arg, ["input"]); return store.createTask(arg.input);
    case "resume_task": keys(arg, ["handle"]); return store.resumeTask(string(arg.handle, 64));
    case "read_result": keys(arg, ["handle"]); return store.readResult(string(arg.handle, 64));
    case "export_brief": {
      keys(arg, ["handle", "path", "format"]);
      const text = await store.exportBrief(string(arg.handle, 64), arg.format ?? "brief");
      await publishPrivateText(string(arg.path, 32767), text);
      return true;
    }
    case "export_task": {
      keys(arg, ["handle", "path"]);
      const text = await store.exportTask(string(arg.handle, 64));
      await publishPrivateText(string(arg.path, 32767), text);
      return true;
    }
    case "import_reference": keys(arg, ["path"]); return store.importReference(string(arg.path, 32767));
    default: throw new Error("Unknown helper operation");
  }
}

async function reply(request: HelperRequest) {
  try {
    const result = JSON.stringify(await execute(request));
    if (typeof result !== "string") throw new Error("Invalid helper result");
    process.stdout.write(encodeResponseFrame({ id: request.id, ok: true, result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operation failed";
    process.stdout.write(encodeResponseFrame({ id: request.id, ok: false, error: boundErrorMessage(message) }));
  }
}

async function main() {
  let chunks = Buffer.alloc(0);
  for await (const part of process.stdin) {
    chunks = Buffer.concat([chunks, part as Buffer]);
    if (chunks.length > MAX_REQUEST_FRAME) throw new Error("Input exceeds frame limit");
    let newline: number;
    while ((newline = chunks.indexOf(10)) >= 0) {
      const frame = chunks.subarray(0, newline);
      chunks = chunks.subarray(newline + 1);
      const request = parseRequestFrame(frame, priorId);
      priorId = request.id;
      await reply(request);
    }
  }
  if (chunks.length) throw new Error("Incomplete request frame");
}

main().catch(() => { process.exitCode = 1; });

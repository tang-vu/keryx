import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { NATIVE_WRITER_PROTOCOL, verifyNativeWriterArtifact } from "./native-writer-artifact";

const protocol = z.object({ protocol: z.literal(NATIVE_WRITER_PROTOCOL), engine: z.literal("keryx-engine") }).strict();
const state = z.enum(["unix_synced", "windows_visible_entry_unproven"]);
const failureState = z.enum(["refused_unchanged", "retained_partial", "complete_unconfirmed"]);
const createSuccess = z.object({ protocol: z.literal(NATIVE_WRITER_PROTOCOL), operation: z.literal("create"),
  taskId: z.string().uuid(), child: z.string(), state }).strict();
const workspaceSuccess = z.object({ protocol: z.literal(NATIVE_WRITER_PROTOCOL), operation: z.literal("workspace-create"),
  child: z.string(), state }).strict();
const createFailure = z.object({ protocol: z.literal(NATIVE_WRITER_PROTOCOL), operation: z.literal("create"),
  state: failureState, stage: z.string().min(1), message: z.string().min(1) }).strict();
const workspaceFailure = createFailure.extend({ operation: z.literal("workspace-create") });
const MAX_INPUT_BYTES = 16_384;
const MAX_OUTPUT_BYTES = 8_192;
const MAX_DEADLINE_MS = 60_000;
const REAP_GRACE_MS = 2_000;

export type NativeWriterConfig = { binaryPath: string; manifestPath: string; expectedSourceCommit: string;
  deadlineMs?: number };
export type NativeCreateInput = { parent: string; child: string; request: unknown; payee: string;
  maxTotalMicros: string; id: string; createdAt: string; network?: "eip155:5042" | "eip155:5042002" };
export type NativeCreateResult = { taskId: string; child: string; state: z.infer<typeof state> };
export type NativeWorkspaceResult = { child: string; state: z.infer<typeof state> };

export class NativeTaskWriterError extends Error {
  constructor(readonly state: z.infer<typeof failureState> | "unknown", readonly stage: string,
    readonly reason: string) {
    super(`Native task writer ${stage}: ${reason}`);
    this.name = "NativeTaskWriterError";
  }
}

function jsonLine(bytes: Buffer): unknown {
  if (bytes.length === 0 || bytes.length > MAX_OUTPUT_BYTES || bytes[bytes.length - 1] !== 10) {
    throw new Error("invalid response length or termination");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.slice(0, -1).includes("\n")) throw new Error("multiple response lines");
    return JSON.parse(text);
  } catch { throw new Error("invalid response encoding or JSON"); }
}

type ChildResult = { code: number | null; signal: NodeJS.Signals | null; stdout: Buffer; stderrBytes: number };

/** One fixed artifact, one process at a time. An unconfirmed exit poisons this adapter. */
export class NativeTaskWriter {
  private busy = false;
  private poisoned = false;
  private readonly config: Readonly<NativeWriterConfig>;

  constructor(config: NativeWriterConfig) {
    if (!isAbsolute(config.binaryPath) || !isAbsolute(config.manifestPath)
      || !/^[a-f0-9]{40}$/.test(config.expectedSourceCommit)) {
      throw new NativeTaskWriterError("refused_unchanged", "artifact", "invalid trusted artifact configuration");
    }
    if (config.deadlineMs !== undefined && (!Number.isInteger(config.deadlineMs)
      || config.deadlineMs < 1 || config.deadlineMs > MAX_DEADLINE_MS)) {
      throw new NativeTaskWriterError("refused_unchanged", "artifact", "invalid process deadline");
    }
    this.config = Object.freeze({ ...config });
  }

  async create(input: NativeCreateInput, signal?: AbortSignal): Promise<NativeCreateResult> {
    const snapshot = { ...input };
    const value = await this.execute("create", snapshot, signal);
    const result = createSuccess.parse(value);
    if (result.taskId !== snapshot.id || result.child !== snapshot.child) {
      throw new NativeTaskWriterError("unknown", "response", "native creation identity differs from request");
    }
    return { taskId: result.taskId, child: result.child, state: result.state };
  }

  async createWorkspace(parent: string, child: string, signal?: AbortSignal): Promise<NativeWorkspaceResult> {
    const value = await this.execute("workspace-create", { parent, child }, signal);
    const result = workspaceSuccess.parse(value);
    if (result.child !== child) {
      throw new NativeTaskWriterError("unknown", "response", "native workspace identity differs from request");
    }
    return { child: result.child, state: result.state };
  }

  private async execute(operation: "create" | "workspace-create", input: object, signal?: AbortSignal): Promise<unknown> {
    if (this.poisoned) throw new NativeTaskWriterError("unknown", "adapter", "prior writer exit unconfirmed");
    if (this.busy) throw new NativeTaskWriterError("refused_unchanged", "adapter", "writer busy");
    if (signal?.aborted) throw new NativeTaskWriterError("refused_unchanged", "input", "canceled before launch");
    let bytes: Buffer;
    try { bytes = Buffer.from(JSON.stringify(input)); }
    catch { throw new NativeTaskWriterError("refused_unchanged", "input", "writer input is not serializable"); }
    if (bytes.length > MAX_INPUT_BYTES) {
      throw new NativeTaskWriterError("refused_unchanged", "input", "writer input exceeds 16 KiB");
    }
    this.busy = true;
    try {
      try {
        await verifyNativeWriterArtifact(this.config.binaryPath, this.config.manifestPath,
          this.config.expectedSourceCommit);
      } catch {
        throw new NativeTaskWriterError("refused_unchanged", "artifact", "trusted writer artifact unavailable");
      }
      if (signal?.aborted) throw new NativeTaskWriterError("refused_unchanged", "input", "canceled before launch");
      const deadlineAt = performance.now() + (this.config.deadlineMs ?? 10_000);
      const hello = await this.child(["writer-protocol"], undefined, deadlineAt, false, signal);
      let helloValid = false;
      try { helloValid = protocol.safeParse(jsonLine(hello.stdout)).success; } catch { /* refusal below */ }
      if (hello.code !== 0 || hello.signal || hello.stderrBytes || !helloValid) {
        throw new NativeTaskWriterError("refused_unchanged", "protocol", "unsupported writer protocol");
      }
      if (signal?.aborted) throw new NativeTaskWriterError("refused_unchanged", "input", "canceled before launch");
      const output = await this.child([operation], bytes, deadlineAt, true, signal);
      if (output.signal || output.stderrBytes || output.code === null) {
        throw new NativeTaskWriterError("unknown", "transport", "writer outcome unavailable");
      }
      let response: unknown;
      try { response = jsonLine(output.stdout); }
      catch { throw new NativeTaskWriterError("unknown", "response", "writer response unavailable"); }
      if (output.code === 1) {
        const failure = (operation === "create" ? createFailure : workspaceFailure).safeParse(response);
        if (!failure.success) throw new NativeTaskWriterError("unknown", "response", "invalid native refusal");
        throw new NativeTaskWriterError(failure.data.state, failure.data.stage, failure.data.message);
      }
      if (output.code !== 0) throw new NativeTaskWriterError("unknown", "transport", "writer exited without a typed result");
      if (!(operation === "create" ? createSuccess : workspaceSuccess).safeParse(response).success) {
        throw new NativeTaskWriterError("unknown", "response", "invalid native success");
      }
      return response;
    } catch (error) {
      if (error instanceof NativeTaskWriterError) throw error;
      throw new NativeTaskWriterError("unknown", "transport", "writer outcome unavailable");
    } finally { if (!this.poisoned) this.busy = false; }
  }

  private child(argv: string[], input: Buffer | undefined, deadlineAt: number, mutating: boolean,
    signal?: AbortSignal): Promise<ChildResult> {
    const remaining = deadlineAt - performance.now();
    if (signal?.aborted) throw new NativeTaskWriterError("refused_unchanged", "input", "canceled before launch");
    if (remaining <= 0) throw new NativeTaskWriterError("refused_unchanged", "deadline", "deadline expired before launch");
    return new Promise((resolve, reject) => {
      const env = process.platform === "win32"
        ? { NODE_ENV: "production" as const, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }
        : { NODE_ENV: "production" as const };
      let child;
      try {
        child = spawn(this.config.binaryPath, argv, { cwd: dirname(this.config.binaryPath), env,
          shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        reject(new NativeTaskWriterError(mutating ? "unknown" : "refused_unchanged", "launch", "cannot launch writer"));
        return;
      }
      const chunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let done = false;
      let failed: string | undefined;
      let reapTimer: NodeJS.Timeout | undefined;
      const clean = () => { clearTimeout(deadlineTimer); if (reapTimer) clearTimeout(reapTimer);
        signal?.removeEventListener("abort", canceled); };
      const failAndKill = (reason: string) => {
        if (done || failed) return;
        failed = reason;
        try { child.kill("SIGKILL"); } catch { /* close still required */ }
        reapTimer = setTimeout(() => {
          if (done) return;
          done = true;
          this.poisoned = true;
          clean();
          child.stdout?.destroy(); child.stderr?.destroy(); child.stdin?.destroy(); child.unref();
          reject(new NativeTaskWriterError("unknown", "transport", "writer exit unconfirmed"));
        }, REAP_GRACE_MS);
      };
      const canceled = () => failAndKill("canceled");
      const deadlineTimer = setTimeout(() => failAndKill("deadline exceeded"), remaining);
      signal?.addEventListener("abort", canceled, { once: true });
      if (signal?.aborted) canceled();
      child.stdout!.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) failAndKill("stdout limit exceeded");
        else if (!failed) chunks.push(chunk);
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_OUTPUT_BYTES) failAndKill("stderr limit exceeded");
      });
      child.stdout!.on("error", () => failAndKill("stdout pipe failed"));
      child.stderr!.on("error", () => failAndKill("stderr pipe failed"));
      child.stdin?.on("error", () => failAndKill("stdin pipe failed"));
      child.on("error", () => failAndKill("cannot launch writer"));
      child.on("close", (code, signal) => {
        if (done) return;
        done = true; clean();
        if (failed || performance.now() >= deadlineAt) {
          reject(new NativeTaskWriterError(mutating ? "unknown" : "refused_unchanged", "transport", failed ?? "deadline exceeded"));
        } else resolve({ code, signal, stdout: Buffer.concat(chunks, stdoutBytes), stderrBytes });
      });
      child.stdin.end(input);
    });
  }
}

export function createNativeTaskWriter(config: NativeWriterConfig): NativeTaskWriter {
  return new NativeTaskWriter(config);
}

/** The Operator CLI trusts its own checkout revision, independently of the manifest. */
export function repositoryNativeTaskWriter(repoRoot: string): NativeTaskWriter {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, shell: false,
    encoding: "utf8", timeout: 10_000, maxBuffer: 4096, windowsHide: true });
  if (revision.error || revision.status !== 0 || revision.signal || !/^[a-f0-9]{40}$/.test(revision.stdout.trim())) {
    throw new NativeTaskWriterError("refused_unchanged", "artifact", "cannot verify checkout revision");
  }
  const directory = join(repoRoot, ".artifacts", "native-writer");
  return createNativeTaskWriter({ binaryPath: join(directory, process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine"),
    manifestPath: join(directory, "manifest.json"), expectedSourceCommit: revision.stdout.trim() });
}

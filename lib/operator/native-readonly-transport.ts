import { spawn } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { NATIVE_READONLY_PROTOCOL, verifyNativeReadonlyArtifact } from "./native-readonly-artifact";

export type NativeReadonlyCommand = "status" | "result" | "brief";

const protocolResponse = z.object({
  protocol: z.literal(NATIVE_READONLY_PROTOCOL), engine: z.literal("keryx-engine"),
}).strict();
const observation = z.object({ observedAt: z.string(),
  status: z.enum(["queued", "processing", "review_required", "completed", "failed", "not_found_uncertain"]),
  payment: z.enum(["seller_reported_settled", "unconfirmed"]),
  accountingAgreement: z.enum(["matches", "differs", "unavailable"]), authority: z.string() }).strict();
const statusResponse = z.object({
  schema: z.literal("keryx-operator-task-status-v1"), taskId: z.string(), createdAt: z.string(),
  kind: z.literal("paid_research"), network: z.literal("eip155:5042002"),
  stage: z.enum(["ready", "journal_incomplete", "buyer_journaled"]),
  buyerJobId: z.string().nullable(),
  creatorBudgetMicros: z.number().refine(value => Number.isFinite(value) && Number.isInteger(value)),
  maxTotalMicros: z.string(),
  payment: z.literal("unknown"), delivery: z.literal("unknown"), lastObservation: observation.nullable(),
  savedResult: z.enum(["absent", "invalid", "present_unchecked"]), authority: z.string(),
}).strict();
const resultResponse = z.object({ savedAt: z.string(), answer: z.string(), question: z.string(),
  citations: z.array(z.object({ marker: z.string(), sourceName: z.string() }).strict()),
  paymentAtCheck: z.enum(["seller_reported_settled", "unconfirmed"]),
  receiptDigest: z.string(), authority: z.string(),
}).strict();

type Status = z.infer<typeof statusResponse>;
type Result = z.infer<typeof resultResponse>;
type Stage = "protocol" | "command";
const MAX_DEADLINE_MS = 60_000;
const MAX_STDOUT_BYTES = 1_000_000;
const MAX_STDERR_BYTES = 8_192;
const REAP_GRACE_MS = 2_000;

export class NativeInspectionError extends Error {
  constructor(readonly phase: "artifact" | Stage, readonly reason: string) {
    super(`Native inspection ${phase}: ${reason}`);
    this.name = "NativeInspectionError";
  }
}

class UnreapedNativeChildError extends NativeInspectionError {
  constructor(phase: Stage) { super(phase, "child exit could not be confirmed after termination"); }
}

function decode(bytes: Buffer, phase: Stage) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new NativeInspectionError(phase, "invalid UTF-8 output"); }
}

function strictJson(bytes: Buffer, phase: Stage) {
  try { return JSON.parse(decode(bytes, phase)) as unknown; }
  catch (error) {
    if (error instanceof NativeInspectionError) throw error;
    throw new NativeInspectionError(phase, "invalid JSON output");
  }
}

export class NativeReadonlyTransport {
  private busy = false;
  private poisoned = false;
  private readonly config: Readonly<{
    binaryPath: string;
    manifestPath: string;
    expectedSourceCommit: string;
    deadlineMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
  }>;

  constructor(config: {
    binaryPath: string;
    manifestPath: string;
    expectedSourceCommit: string;
    deadlineMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
  }) {
    if (!isAbsolute(config.binaryPath) || !isAbsolute(config.manifestPath)) {
      throw new NativeInspectionError("artifact", "binary and manifest paths must be absolute");
    }
    if (config.deadlineMs !== undefined && (!Number.isInteger(config.deadlineMs)
      || config.deadlineMs < 1 || config.deadlineMs > MAX_DEADLINE_MS)) {
      throw new NativeInspectionError("artifact", "deadline outside supported bounds");
    }
    for (const [name, value, limit] of [
      ["stdout", config.maxStdoutBytes, MAX_STDOUT_BYTES],
      ["stderr", config.maxStderrBytes, MAX_STDERR_BYTES],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > limit)) {
        throw new NativeInspectionError("artifact", `${name} limit outside supported bounds`);
      }
    }
    // Keep the validated identity and limits fixed across hash, handshake and
    // command even if the caller mutates its original options object.
    this.config = Object.freeze({ ...config });
  }

  async inspect(command: "status", state: string, signal?: AbortSignal): Promise<Status>;
  async inspect(command: "result", state: string, signal?: AbortSignal): Promise<Result>;
  async inspect(command: "brief", state: string, signal?: AbortSignal): Promise<Buffer>;
  async inspect(command: NativeReadonlyCommand, state: string, signal?: AbortSignal): Promise<Status | Result | Buffer>;
  async inspect(command: NativeReadonlyCommand, state: string, signal?: AbortSignal): Promise<Status | Result | Buffer> {
    if (this.busy || this.poisoned) throw new NativeInspectionError("command", "adapter busy or child exit unconfirmed");
    this.busy = true;
    try {
      if (signal?.aborted) throw new NativeInspectionError("artifact", "canceled before launch");
      if (!isAbsolute(state)) throw new NativeInspectionError("command", "task path must be absolute");
      if (!["status", "result", "brief"].includes(command)) {
        throw new NativeInspectionError("command", "unsupported read-only command");
      }
      try {
        await verifyNativeReadonlyArtifact(this.config.binaryPath, this.config.manifestPath,
          this.config.expectedSourceCommit);
      } catch (error) {
        throw new NativeInspectionError("artifact", error instanceof Error ? error.message : "verification failed");
      }
      if (signal?.aborted) throw new NativeInspectionError("artifact", "canceled before launch");
      // One monotonic deadline covers both child processes. Artifact verification
      // occurs first and cannot consume this process budget.
      const deadlineAt = performance.now() + (this.config.deadlineMs ?? 10_000);
      const protocol = await this.child("protocol", ["protocol"], deadlineAt, signal);
      if (!protocolResponse.safeParse(strictJson(protocol, "protocol")).success) {
        throw new NativeInspectionError("protocol", "unsupported protocol response");
      }
      const output = await this.child("command", [command, "--state", state], deadlineAt, signal);
      if (command === "brief") {
        if (output.length === 0) throw new NativeInspectionError("command", "empty brief output");
        decode(output, "command");
        this.requireLiveDeadline(deadlineAt, signal);
        return output;
      }
      const value = strictJson(output, "command");
      const parsed = command === "status" ? statusResponse.safeParse(value) : resultResponse.safeParse(value);
      if (!parsed.success) throw new NativeInspectionError("command", "unexpected response shape");
      this.requireLiveDeadline(deadlineAt, signal);
      return parsed.data;
    } catch (error) {
      if (error instanceof UnreapedNativeChildError) this.poisoned = true;
      throw error;
    } finally {
      if (!this.poisoned) this.busy = false;
    }
  }

  private requireLiveDeadline(deadlineAt: number, signal?: AbortSignal) {
    if (signal?.aborted) throw new NativeInspectionError("command", "canceled");
    if (performance.now() >= deadlineAt) throw new NativeInspectionError("command", "deadline exceeded");
  }

  private child(phase: Stage, argv: string[], deadlineAt: number, signal?: AbortSignal): Promise<Buffer> {
    const remaining = deadlineAt - performance.now();
    if (signal?.aborted) throw new NativeInspectionError(phase, "canceled before launch");
    if (remaining <= 0) throw new NativeInspectionError(phase, "deadline expired before launch");
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = process.platform === "win32"
        ? { NODE_ENV: "production", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }
        : { NODE_ENV: "production" };
      let child;
      try {
        child = spawn(this.config.binaryPath, argv, {
          cwd: dirname(this.config.binaryPath), env, shell: false, windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        reject(new NativeInspectionError(phase, "cannot launch child"));
        return;
      }
      const stdout: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let failed: NativeInspectionError | undefined;
      let done = false;
      let reapTimer: NodeJS.Timeout | undefined;
      const clean = () => {
        clearTimeout(deadlineTimer);
        if (reapTimer) clearTimeout(reapTimer);
        signal?.removeEventListener("abort", canceled);
      };
      const failAndKill = (reason: string) => {
        if (done || failed) return;
        failed = new NativeInspectionError(phase, reason);
        try { child.kill("SIGKILL"); } catch { /* no success until close confirms exit */ }
        reapTimer = setTimeout(() => {
          if (!done) {
            done = true;
            clean();
            // The OS did not confirm exit. Drop local handles so the caller can
            // report failure, but leave this adapter unusable to prevent overlap.
            try { child.kill("SIGKILL"); } catch { /* exit is still unconfirmed */ }
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            reject(new UnreapedNativeChildError(phase));
          }
        }, REAP_GRACE_MS);
      };
      const canceled = () => failAndKill("canceled");
      const deadlineTimer = setTimeout(() => failAndKill("deadline exceeded"), remaining);
      signal?.addEventListener("abort", canceled, { once: true });
      if (signal?.aborted) canceled();
      child.stdout.on("data", (chunk: Buffer) => {
        if (failed) return;
        stdoutSize += chunk.length;
        if (stdoutSize > (this.config.maxStdoutBytes ?? MAX_STDOUT_BYTES)) failAndKill("stdout byte limit exceeded");
        else if (!failed) stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (failed) return;
        stderrSize += chunk.length;
        if (stderrSize > (this.config.maxStderrBytes ?? MAX_STDERR_BYTES)) failAndKill("stderr byte limit exceeded");
      });
      child.stdout.on("error", () => failAndKill("stdout pipe failed"));
      child.stderr.on("error", () => failAndKill("stderr pipe failed"));
      child.on("error", () => failAndKill("cannot launch child"));
      child.on("close", (code, childSignal) => {
        if (done) return;
        done = true;
        clean();
        if (failed) reject(failed);
        else if (performance.now() >= deadlineAt) reject(new NativeInspectionError(phase, "deadline exceeded"));
        else if (code !== 0 || childSignal) reject(new NativeInspectionError(phase, "child refused or exited abnormally"));
        else resolve(Buffer.concat(stdout, stdoutSize));
      });
    });
  }
}

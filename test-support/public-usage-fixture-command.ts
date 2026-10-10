import { spawn } from "node:child_process";

const MAX_BYTES = 2 * 1024 * 1024, TIMEOUT_MS = 30000;
const ERROR_CODES = new Set(["EPIPE", "ENOENT", "EACCES", "EPERM", "EINVAL", "EBADF", "ECONNRESET", "ETIMEDOUT", "EIO", "EBUSY", "ENOTDIR", "EMFILE", "ENFILE", "ENOSPC"]);
function errorCode(source: "SPAWN" | "STDIN", error: Error & { code?: string }) {
  return `${source}_${ERROR_CODES.has(error.code ?? "") ? error.code : "UNKNOWN"}`;
}

/** Fixed bounds for the owned ordinary usage fixture; no-input commands never open stdin. */
export async function capturePublicUsageFixtureCommand(executable: string, args: string[], env: Record<string, string | undefined>, input?: string) {
  const inputMode = input === undefined ? "none" as const : "payload" as const;
  // Next augments ProcessEnv with a required NODE_ENV; Node accepts a minimal OS-only map.
  const child = spawn(executable, args, { env: env as NodeJS.ProcessEnv, stdio: [inputMode === "none" ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), error: string | null = null;
  let overflow = false, timedOut = false, outEOF = false, errEOF = false, exitObserved = false;
  const keep = (current: Buffer, chunk: Buffer) => {
    if (current.length + chunk.length > MAX_BYTES) { overflow = true; child.kill(); }
    return Buffer.concat([current, chunk]).subarray(0, MAX_BYTES);
  };
  child.stdout!.on("data", chunk => { stdout = keep(stdout, chunk); });
  child.stderr!.on("data", chunk => { stderr = keep(stderr, chunk); });
  child.stdout!.on("end", () => { outEOF = true; }); child.stderr!.on("end", () => { errEOF = true; });
  child.on("error", cause => { error ??= errorCode("SPAWN", cause); });
  child.on("exit", () => { exitObserved = true; });
  if (child.stdin) child.stdin.on("error", cause => { error ??= errorCode("STDIN", cause); });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
  if (input !== undefined) child.stdin!.end(input);
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(done =>
    child.on("close", (exitCode, signal) => done({ exitCode, signal })));
  clearTimeout(timer);
  return { ...result, closeObserved: true, exitObserved, inputMode, outEOF, errEOF, errorCode: error, overflow, timedOut, stdout, stderr };
}
type Capture = Awaited<ReturnType<typeof capturePublicUsageFixtureCommand>>;
export function publicUsageFixtureCommandSucceeded(capture: Capture) {
  return capture.exitCode === 0 && capture.exitObserved && capture.closeObserved && capture.signal === null && capture.errorCode === null
    && !capture.overflow && !capture.timedOut && capture.outEOF && capture.errEOF;
}
/** Finite diagnostic fields only: no executable, arguments, environment, input or raw output. */
export function publicUsageFixtureCommandDiagnostic(label: string, capture: Capture) {
  if (!/^command-\d{4,6}$/.test(label)) throw Error("Invalid fixture command label");
  const stderr = capture.stderr.toString("utf8");
  const reason = /\busage_unavailable\b/.test(stderr) ? "usage_unavailable"
    : /\bpermission denied\b/.test(stderr) ? "permission denied" : stderr.length ? "unclassified" : "empty";
  return { label, exitCode: capture.exitCode, signal: capture.signal, exitObserved: capture.exitObserved,
    closeObserved: capture.closeObserved, inputMode: capture.inputMode, outEOF: capture.outEOF, errEOF: capture.errEOF,
    errorCode: capture.errorCode, overflow: capture.overflow, timedOut: capture.timedOut, reason };
}

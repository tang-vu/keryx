import { spawnSync } from "node:child_process";

const DEADLINE_MS = 120000;
// npm 11.19's Timers emits `npm timing <name> Completed in <ms>ms`.
// Only these literal phase names and bounded numbers may leave the child logs.
const PHASES = new Set(["npm", "npm:load", "npm:load:whichnode", "npm:load:configload", "npm:load:mkdirpcache",
  "npm:load:mkdirplogs", "npm:load:setTitle", "command:install", "idealTree", "idealTree:init", "idealTree:userRequests",
  "idealTree:buildDeps", "reify", "reify:loadTrees", "reify:diffTrees", "reify:createSparse",
  "reify:unpack", "reify:build", "reify:save"]);
const bytes = value => Buffer.isBuffer(value) ? value.length : typeof value === "string" ? Buffer.byteLength(value) : 0;
const text = value => Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : "";
/** @type {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptions) => import("node:child_process").SpawnSyncReturns<string | Buffer>} */
const executeInstall = (command, args, options) => spawnSync(command, args, options);

function summary(stdout, stderr, elapsedMs, category, status, signal) {
  const completedPhases = {};
  let lastCompletedPhase = null;
  for (const line of `${text(stdout)}\n${text(stderr)}`.split(/\r?\n/)) {
    const match = line.replace(/\u001b\[[0-9;]*m/g, "").match(/^npm timing ([a-zA-Z:]+) Completed in (\d{1,9})ms$/);
    if (!match || !PHASES.has(match[1]) || Number(match[2]) > DEADLINE_MS) continue;
    completedPhases[match[1]] = Number(match[2]); lastCompletedPhase = match[1];
  }
  return { stage: "clean-consumer-install", category, elapsedMs, deadlineMs: DEADLINE_MS,
    preferOffline: true, status, signal, stdoutBytes: bytes(stdout), stderrBytes: bytes(stderr),
    lastCompletedPhase, completedPhases };
}

/** A fresh consumer install: npm's integrity-checked cache is preferred; missing data may still be fetched. */
export function installPackedConsumer(npmCli, tarball, workspace, {
  execute = executeInstall, now = () => performance.now(), report = line => console.log(line),
} = {}) {
  const started = now();
  let result;
  try {
    result = execute(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund",
      "--prefer-offline", "--timing", tarball], { cwd: workspace, stdio: "pipe", timeout: DEADLINE_MS });
  } catch (error) { result = { error }; }
  const category = result?.error?.code === "ETIMEDOUT" ? "timeout" : result?.error?.code === "ENOBUFS" ? "output-limit"
    : ["ENOENT", "EACCES"].includes(result?.error?.code) ? "spawn"
    : !result?.error && result?.status === 0 ? "success" : Number.isInteger(result?.status) ? "exit" : "unknown";
  const status = Number.isInteger(result?.status) && result.status >= 0 && result.status <= 255 ? result.status : null;
  const signal = ["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV"].includes(result?.signal) ? result.signal : null;
  report(JSON.stringify(summary(result?.stdout, result?.stderr, Math.max(0, Math.round(now() - started)), category, status, signal)));
  // Never forward npm's exception, log bytes, arguments, environment or timing-file metadata.
  if (category !== "success") throw new Error(`Clean consumer dependency install failed (${category}); sanitized timing summary above`);
}

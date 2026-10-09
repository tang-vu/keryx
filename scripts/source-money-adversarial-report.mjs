import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ATTACK_CASES = Object.freeze(["prefer-cite", "payee-substitution", "reward-price-repeat", "forged-approval",
  "citation-farming", "bad-delivery", "exfiltration", "hidden-encoded"]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const OS_KEYS = new Set(["path", "systemroot", "windir", "systemdrive", "comspec", "pathext", "temp", "tmp", "tmpdir",
  "appdata", "localappdata", "userprofile", "home", "lang", "lc_all", "lc_ctype", "tz"]);

export function adversarialEnvironment(input) {
  return { ...Object.fromEntries(Object.entries(input).filter(([key]) => OS_KEYS.has(key.toLowerCase()))),
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
    KERYX_EXTERNAL_DISCOVERY: "0", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
}

/** End/exit/close fields are set only by real child events, including refusal captures. */
export async function captureProcess(executable, args, { cwd, env, timeoutMs = 120_000, maxBytes = MAX_CAPTURE_BYTES }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CAPTURE_BYTES) throw new Error("Invalid capture bounds");
  const start = performance.now();
  const result = { executable, args, startedAt: new Date().toISOString(), exitObserved: false, closeObserved: false,
    exitCode: null, signal: null, timedOut: false, captureOverflow: false, errors: [],
    stdout: { eof: false, bytesObserved: 0, chunks: [] }, stderr: { eof: false, bytesObserved: 0, chunks: [] } };
  const child = spawn(executable, args, { cwd, env, detached: process.platform !== "win32",
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let retained = 0, killed = false, grace;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  function stop() {
    if (killed) return;
    killed = true;
    if (Number.isSafeInteger(child.pid) && child.pid > 0) {
      if (process.platform === "win32") {
        // Only this freshly owned PID and its descendants; never a computed shell command.
        const taskkill = path.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "taskkill.exe");
        const cleanup = spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"],
          { env, windowsHide: true, stdio: "ignore", timeout: 1000 });
        result.cleanup = { attempted: true, exitCode: cleanup.status, signal: cleanup.signal,
          error: cleanup.error?.code ?? null };
      } else {
        try { process.kill(-child.pid, "SIGKILL"); result.cleanup = { attempted: true, error: null }; }
        catch (error) { result.cleanup = { attempted: true, error: error.code ?? "unknown" }; }
      }
    }
    grace = setTimeout(() => {
      // No invented EOF or exit code if owned cleanup cannot obtain a real close.
      child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish();
    }, 5000);
  }
  for (const channel of ["stdout", "stderr"]) {
    child[channel].on("data", chunk => {
      result[channel].bytesObserved += chunk.length;
      const keep = Math.min(chunk.length, Math.max(0, maxBytes - retained));
      if (keep) { result[channel].chunks.push(chunk.subarray(0, keep)); retained += keep; }
      if (keep < chunk.length) { result.captureOverflow = true; stop(); }
    });
    child[channel].once("end", () => { result[channel].eof = true; });
    child[channel].on("error", error => { result.errors.push({ channel, name: error.name, code: error.code ?? null }); stop(); });
  }
  child.on("error", error => { result.errors.push({ name: error.name, code: error.code ?? null }); });
  child.once("exit", (code, signal) => { result.exitObserved = true; result.exitCode = code; result.signal = signal; });
  child.once("close", () => { result.closeObserved = true; finish(); });
  const timer = setTimeout(() => { result.timedOut = true; stop(); }, timeoutMs);
  await done; clearTimeout(timer); clearTimeout(grace);
  for (const channel of ["stdout", "stderr"]) {
    result[channel].raw = Buffer.concat(result[channel].chunks); delete result[channel].chunks;
    result[channel].bytesRetained = result[channel].raw.length;
    result[channel].sha256 = sha256(result[channel].raw);
  }
  result.completedAt = new Date().toISOString(); result.elapsedMs = Math.round(performance.now() - start);
  return result;
}

export function completeCapture(capture) {
  return capture?.exitObserved === true && capture.closeObserved === true && capture.exitCode === 0 &&
    capture.signal === null && capture.timedOut === false && capture.captureOverflow === false &&
    Array.isArray(capture.errors) && capture.errors.length === 0 && capture.stdout?.eof === true && capture.stderr?.eof === true;
}

export function captureMetadata(capture) {
  return { ...capture, stdout: { ...capture.stdout, raw: undefined }, stderr: { ...capture.stderr, raw: undefined } };
}

export async function writeCaptureArtifacts(directory, name, capture) {
  if (!/^[a-z-]+$/.test(name)) throw new Error("Invalid artifact name");
  for (const channel of ["stdout", "stderr"]) {
    await fs.writeFile(path.join(directory, `${name}.${channel}.raw`), capture[channel].raw, { flag: "wx" });
  }
  await fs.writeFile(path.join(directory, `${name}.capture.json`), JSON.stringify(captureMetadata(capture), null, 2) + "\n", { flag: "wx" });
}

export async function readBoundedFile(file, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new Error("Invalid file bounds");
  const handle = await fs.open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error("File exceeds capture bounds");
    const buffer = Buffer.alloc(info.size + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used !== info.size || (await handle.stat()).size !== info.size) throw new Error("File changed while captured");
    return buffer.subarray(0, used);
  } finally { await handle.close(); }
}

/** All tracked lib/test-support inputs, plus the runner/workflow/config/lock inputs; no dependency-tree scan. */
export async function snapshotSource(root, env, artifacts) {
  const fixed = ["scripts/test-source-money-adversarial.mjs", "scripts/source-money-adversarial-report.mjs",
    "scripts/source-money-adversarial-report.test.mjs", ".github/workflows/ci.yml", "package.json", "package-lock.json",
    "vitest.config.mts", "tsconfig.json"];
  const runGit = async (name, args) => {
    const capture = await captureProcess("git", ["-c", "core.fsmonitor=false", ...args], { cwd: root, env, timeoutMs: 10_000, maxBytes: 1024 * 1024 });
    if (artifacts) await writeCaptureArtifacts(artifacts.directory, `${artifacts.phase}-${name}`, capture);
    return capture;
  };
  const head = await runGit("head", ["rev-parse", "HEAD"]), tree = await runGit("tree", ["rev-parse", "HEAD^{tree}"]);
  const status = await runGit("status", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const listed = await runGit("files", ["ls-files", "-z", "--", "lib", "test-support", ...fixed]);
  const result = { valid: false, head: head.stdout.raw.toString().trim(), tree: tree.stdout.raw.toString().trim(),
    workingTree: completeCapture(status) ? (status.stdout.raw.length ? "modified" : "clean") : "unavailable", captures: {
      head: captureMetadata(head), tree: captureMetadata(tree), status: captureMetadata(status), files: captureMetadata(listed) } };
  if (![head, tree, status, listed].every(completeCapture) || !/^[a-f0-9]{40}$/.test(result.head) ||
      !/^[a-f0-9]{40}$/.test(result.tree)) return result;
  const names = listed.stdout.raw.toString("utf8").split("\0").filter(Boolean).sort();
  if (names.length > 10_000 || fixed.some(name => !names.includes(name))) return result;
  const manifest = []; let total = 0;
  try {
    for (const name of names) {
      const file = path.resolve(root, name), relative = path.relative(root, file);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return result;
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) return result;
      total += info.size; if (total > 64 * 1024 * 1024) return result;
      const bytes = await readBoundedFile(file, Math.max(1, info.size));
      manifest.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    // Lock/config and installed runner metadata are distinct; this is not whole dependency-closure attestation.
    const vitest = await readBoundedFile(path.join(root, "node_modules/vitest/package.json"), 1024 * 1024);
    result.runtime = { node: process.versions.node, executable: process.execPath, vitestMetadataSha256: sha256(vitest),
      dependencyClosure: "not attested by this report" };
    result.inputs = { files: manifest.length, bytes: total, sha256: sha256(JSON.stringify(manifest)), manifest };
    result.valid = true;
  } catch { result.valid = false; }
  return result;
}

function qualifiedSnapshot(snapshot) {
  return snapshot?.valid === true && snapshot.workingTree === "clean" && /^[a-f0-9]{40}$/.test(snapshot.head ?? "") &&
    /^[a-f0-9]{40}$/.test(snapshot.tree ?? "") && /^[a-f0-9]{64}$/.test(snapshot.inputs?.sha256 ?? "") &&
    Number.isSafeInteger(snapshot.inputs?.files) && snapshot.inputs.files > 0 && snapshot.inputs.files <= 10_000 &&
    Number.isSafeInteger(snapshot.inputs?.bytes) && snapshot.inputs.bytes >= 0 && snapshot.inputs.bytes <= 64 * 1024 * 1024 &&
    typeof snapshot.runtime?.node === "string" && typeof snapshot.runtime.executable === "string" &&
    /^[a-f0-9]{64}$/.test(snapshot.runtime.vitestMetadataSha256 ?? "") &&
    ["head", "tree", "status", "files"].every(name => completeCapture(snapshot.captures?.[name]));
}

export function buildAdversarialReport({ capture, reportBytes, before, after, observedAt = new Date().toISOString() }) {
  const reasons = [];
  if (!completeCapture(capture)) reasons.push("incomplete_process_capture");
  const sourceBound = qualifiedSnapshot(before) && qualifiedSnapshot(after) &&
    before.head === after.head && before.tree === after.tree && before.inputs?.sha256 === after.inputs?.sha256 &&
    JSON.stringify(before.runtime) === JSON.stringify(after.runtime);
  if (!sourceBound) reasons.push("source_binding_unqualified_or_changed");
  let raw, assertions = [], tests = null;
  try {
    if (!Buffer.isBuffer(reportBytes) || reportBytes.length > MAX_CAPTURE_BYTES) throw new Error("report bounds");
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reportBytes));
    if (!Array.isArray(raw.testResults) || raw.testResults.length > 32) throw new Error("suite shape");
    for (const suite of raw.testResults) {
      if (!Array.isArray(suite.assertionResults)) throw new Error("assertion shape");
      assertions.push(...suite.assertionResults);
      if (assertions.length > 10_000) throw new Error("assertion cap");
    }
    if (assertions.some(test => !test || typeof test.title !== "string" || test.title.length > 2048 || typeof test.status !== "string")) throw new Error("assertion type");
    const passed = assertions.filter(test => test.status === "passed").length;
    const failed = assertions.filter(test => test.status === "failed").length;
    if (![raw.numTotalTests, raw.numPassedTests, raw.numFailedTests].every(value => Number.isSafeInteger(value) && value >= 0) ||
        raw.numTotalTests !== assertions.length || raw.numPassedTests !== passed || raw.numFailedTests !== failed) throw new Error("count mismatch");
    tests = { total: assertions.length, passed, failed };
    if (raw.success !== true || passed !== assertions.length || assertions.length === 0) reasons.push("test_execution_not_passed");
  } catch { reasons.push("missing_or_malformed_vitest_report"); assertions = []; }
  const cases = ATTACK_CASES.map(id => {
    const matches = assertions.filter(test => test.title.startsWith(`${id}:`));
    if (matches.length !== 1) reasons.push(matches.length ? `duplicate_case:${id}` : `missing_case:${id}`);
    return { id, status: matches.length === 1 ? matches[0].status : matches.length ? "duplicate" : "missing" };
  });
  return { protocol: "keryx-source-money-adversarial-v1", observedAt, sourceCommit: sourceBound ? before.head : null,
    workingTree: sourceBound ? "clean" : "modified-or-unqualified",
    authority: "Offline deterministic fixtures and injected transport only; no live settlement or provider evidence",
    liveTestnetRefusal: null, success: reasons.length === 0, tests, cases, refusalReasons: reasons,
    vitestReport: Buffer.isBuffer(reportBytes) ? { bytes: reportBytes.length, sha256: sha256(reportBytes) } : null,
    process: captureMetadata(capture), sourceBefore: before, sourceAfter: after };
}

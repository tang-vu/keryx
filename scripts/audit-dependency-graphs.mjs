import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const dependencyGraphScopes = Object.freeze([".", "desktop", "mcp", "cloudflare/migration", "cloudflare/ops-monitor", "cloudflare/source-upkeep"]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execute = promisify(execFile);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

/** Registry/CLI errors and unknown count formats cannot become a green gate.
 * Lower-severity findings remain visible; zero high/critical is not zero flaws. */
export function parseDependencyAudit(raw, exitCode) {
  const report = JSON.parse(raw);
  const counts = report?.metadata?.vulnerabilities;
  const keys = ["info", "low", "moderate", "high", "critical", "total"];
  if (report?.error || !counts || typeof counts !== "object" || Array.isArray(counts) ||
      Object.keys(counts).length !== keys.length || keys.some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0) ||
      keys.slice(0, -1).reduce((sum, key) => sum + counts[key], 0) !== counts.total) throw new Error("Dependency audit report refused");
  return { counts: Object.fromEntries(keys.map(key => [key, counts[key]])), passed: exitCode === 0 && counts.high === 0 && counts.critical === 0 };
}

export async function auditDependencyGraphs({ npmCli, output }) {
  if (!isAbsolute(npmCli) || !output) throw new Error("Supply an absolute pinned npm CLI and an output directory");
  const npm = JSON.parse(await readFile(resolve(dirname(npmCli), "../package.json"), "utf8"));
  if (npm.version !== "11.19.0") throw new Error("Dependency audit requires project-pinned npm 11.19.0");
  await mkdir(output, { recursive: true });
  const run = await mkdtemp(join(resolve(output), "run-"));
  let next = 0;
  const results = [];
  async function scan(scope) {
    const directory = join(run, scope === "." ? "root" : scope.replaceAll("/", "-"));
    await mkdir(directory);
    const inputs = {};
    for (const name of ["package.json", "package-lock.json"]) {
      const bytes = await readFile(join(root, scope, name));
      inputs[name] = sha(bytes); await writeFile(join(directory, name), bytes, { flag: "wx" });
    }
    for (const name of ["user.npmrc", "global.npmrc"]) await writeFile(join(directory, name), "", { flag: "wx" });
    const env = {};
    for (const [key, value] of Object.entries(process.env)) if (["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"].includes(key.toUpperCase())) env[key] = value;
    Object.assign(env, { HOME: directory, USERPROFILE: directory, TEMP: directory, TMP: directory,
      npm_config_cache: join(directory, "npm-cache"), npm_config_userconfig: join(directory, "user.npmrc"),
      npm_config_globalconfig: join(directory, "global.npmrc"), npm_config_registry: "https://registry.npmjs.org",
      npm_config_update_notifier: "false", npm_config_color: "false", npm_config_fetch_retries: "1" });
    let stdout = "", stderr = "", exitCode;
    try {
      ({ stdout, stderr } = await execute(process.execPath, [npmCli, "audit", "--package-lock-only", "--ignore-scripts", "--json", "--audit-level=high"],
        { cwd: directory, env, windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 }));
      exitCode = 0;
    } catch (error) { stdout = error.stdout ?? ""; stderr = error.stderr ?? ""; exitCode = typeof error.code === "number" ? error.code : null; }
    await writeFile(join(directory, "audit.json"), stdout, { flag: "wx" });
    await writeFile(join(directory, "audit.stderr.txt"), stderr, { flag: "wx" });
    for (const [name, digest] of Object.entries(inputs)) if (sha(await readFile(join(root, scope, name))) !== digest ||
      sha(await readFile(join(directory, name))) !== digest) throw new Error("Dependency audit input changed");
    return { scope, inputs, exitCode, ...parseDependencyAudit(stdout, exitCode), originalReport: join(directory, "audit.json") };
  }
  async function worker() {
    while (next < dependencyGraphScopes.length) {
      const scope = dependencyGraphScopes[next++];
      let result;
      try { result = await scan(scope); } catch { result = { scope, passed: false, error: "Audit unavailable or invalid; inspect retained report" }; }
      results.push(result); console.log(JSON.stringify(result));
    }
  }
  await Promise.all([worker(), worker()]);
  const summary = { format: "keryx-locked-dependency-audit-v1", observedAt: new Date().toISOString(),
    node: process.versions.node, npm: npm.version, passed: results.length === dependencyGraphScopes.length && results.every(row => row.passed),
    scopes: results, installOrFix: false, limitation: "Known npm advisory metadata only; lower findings and reachable runtime paths require review." };
  await writeFile(join(run, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--npm-cli" || args[2] !== "--out") throw new Error("Usage: node scripts/audit-dependency-graphs.mjs --npm-cli /path/to/npm/bin/npm-cli.js --out /audit/output");
  const result = await auditDependencyGraphs({ npmCli: args[1], output: args[3] });
  if (!result.passed) process.exitCode = 1;
}

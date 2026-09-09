/** VPS install reuse. Built-in Node modules only: this must work before npm ci. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const stampName = "node_modules/.keryx-dependency-state.json";
const installHooks = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "dependencies"];
const hash = value => createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function dependencyFingerprint(manifest, lock, runtime) {
  const pkg = structuredClone(manifest), tree = structuredClone(lock);
  if (tree.lockfileVersion !== 3 || !tree.packages?.[""] || pkg.name !== tree.name) throw new Error("Unsupported dependency metadata");
  // Lifecycle hooks and local/workspace dependencies may use the root version.
  const local = Object.values({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })
    .some(value => /^(?:file:|link:|workspace:)/.test(String(value)));
  if (!pkg.workspaces && !local && !installHooks.some(name => pkg.scripts?.[name])) {
    delete pkg.version; delete tree.version; delete tree.packages[""].version;
  }
  return hash(JSON.stringify(canonical({ schema: 1, manifest: pkg, lock: tree, runtime })));
}

function npmRuntime() {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : "npm";
  const call = args => execFileSync(command, npmCli ? [npmCli, ...args] : args,
    { encoding: "utf8", timeout: 30_000, maxBuffer: 2_000_000, stdio: ["ignore", "pipe", "pipe"] });
  // Effective registry/auth/config values are hashed in memory, never printed or saved.
  return { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch,
    npm: call(["--version"]).trim(), config: JSON.parse(call(["config", "list", "--json"])) };
}

function current(root, runtime) {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)
      || !existsSync(resolve(root, "node_modules", name, "package.json"))) throw new Error("Missing direct dependency");
  }
  return { schema: 1, fingerprint: dependencyFingerprint(manifest, lock, runtime),
    installedLock: hash(readFileSync(resolve(root, "node_modules/.package-lock.json"))) };
}

export function canReuseDependencies(root, runtime) {
  try {
    const saved = JSON.parse(readFileSync(resolve(root, stampName), "utf8"));
    return JSON.stringify(saved) === JSON.stringify(current(root, runtime));
  } catch { return false; }
}

export function invalidateDependencies(root) { rmSync(resolve(root, stampName), { force: true }); }

/** Call only after successful npm ci. Failure leaves no successful-install stamp. */
export function recordDependencies(root, runtime) {
  const value = current(root, runtime);
  const target = resolve(root, stampName), temporary = `${target}.${process.pid}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); renameSync(temporary, target); }
  finally { rmSync(temporary, { force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  try {
    if (process.argv.length !== 3 || !["check", "invalidate", "record"].includes(mode)) throw new Error("Invalid command");
    if (mode === "invalidate") invalidateDependencies(process.cwd());
    else {
      const runtime = npmRuntime();
      if (mode === "record") recordDependencies(process.cwd(), runtime);
      else process.exitCode = canReuseDependencies(process.cwd(), runtime) ? 0 : 1;
    }
  } catch {
    console.error(mode === "check" ? "Dependency state unknown; installation required." : "Could not update dependency installation state.");
    process.exitCode = 1;
  }
}

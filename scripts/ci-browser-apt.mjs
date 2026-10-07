import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mirrorPath = "/etc/apt/apt-mirrors.txt";
const sourcesPath = "/etc/apt/sources.list.d/ubuntu.sources";
const networkPath = "/etc/apt/apt.conf.d/99-keryx-ci-network";
const runnerMirrors = [
  "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1",
  "https://archive.ubuntu.com/ubuntu/\tpriority:2",
  "https://security.ubuntu.com/ubuntu/\tpriority:3",
].join("\n") + "\n";
const httpsMirrors = [
  "https://archive.ubuntu.com/ubuntu/\tpriority:1",
  "https://security.ubuntu.com/ubuntu/\tpriority:2",
].join("\n") + "\n";
const networkConfig = 'Acquire::http::Timeout "60";\nAcquire::https::Timeout "60";\nAcquire::Retries "2";\n';

export function assertRunnerContext({ env, platform, arch }) {
  if (platform !== "linux" || arch !== "x64" || env.GITHUB_ACTIONS !== "true" ||
      env.RUNNER_ENVIRONMENT !== "github-hosted" || env.RUNNER_OS !== "Linux") {
    throw new Error("Browser APT setup requires a GitHub-hosted Linux x64 runner.");
  }
}

export function browserAptPlan({ osRelease, sources, mirrors, network = null }) {
  for (const [key, expected] of [["ID", "ubuntu"], ["VERSION_ID", "24.04"], ["VERSION_CODENAME", "noble"]]) {
    const values = osRelease.split(/\r?\n/).filter(line => line.startsWith(`${key}=`))
      .map(line => line.slice(key.length + 1).replace(/^"(.*)"$/, "$1"));
    if (values.length !== 1 || values[0] !== expected) throw new Error("Browser APT setup requires Ubuntu 24.04 noble.");
  }
  const uris = [];
  let currentField = null;
  for (const line of sources.split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    if (!line.trim()) { currentField = null; continue; }
    if (/^[ \t]/.test(line)) {
      if (currentField === "uris") uris[uris.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const field = /^([^:\s]+):[ \t]*(.*)$/.exec(line);
    currentField = field?.[1].toLowerCase() ?? null;
    if (currentField === "uris") uris.push(field[2].trim());
  }
  if (uris.length === 0 || uris.some(value => value !== `mirror+file:${mirrorPath}`)) {
    throw new Error("Unexpected Ubuntu runner source configuration; refusing to replace mirrors.");
  }
  if (mirrors !== runnerMirrors && mirrors !== httpsMirrors) {
    throw new Error("Unexpected Ubuntu runner mirror list; refusing to replace mirrors.");
  }
  if (network !== null && network !== networkConfig) {
    throw new Error("Existing browser APT network configuration is not owned by this setup.");
  }
  return [{ path: mirrorPath, content: httpsMirrors }, { path: networkPath, content: networkConfig }];
}

export function prepareBrowserApt({
  env = process.env, platform = process.platform, arch = process.arch,
  read = readFileSync, stat = lstatSync,
  install = installConfig,
} = {}) {
  assertRunnerContext({ env, platform, arch });
  function regularFile(path, optional = false) {
    try {
      const info = stat(path);
      if (!info.isFile() || info.size > 16384) throw new Error("Unexpected browser APT configuration file type or size.");
      return read(path, "utf8");
    } catch (error) {
      if (optional && error.code === "ENOENT") return null;
      throw error;
    }
  }
  const plan = browserAptPlan({
    osRelease: read("/etc/os-release", "utf8"),
    sources: regularFile(sourcesPath), mirrors: regularFile(mirrorPath),
    network: regularFile(networkPath, true),
  });
  for (const entry of plan) {
    install(entry);
    if (regularFile(entry.path) !== entry.content) throw new Error("Browser APT configuration readback did not match.");
  }
}

function installConfig({ path, content }) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-ci-browser-apt-"));
  try {
    const source = join(directory, "config");
    writeFileSync(source, content, { mode: 0o600, flag: "wx" });
    const result = spawnSync("sudo", ["-n", "install", "-m", "0644", source, path], { encoding: "utf8", timeout: 15000 });
    if (result.error || result.status !== 0) throw new Error("Could not install browser APT configuration.");
  } finally {
    // Only this invocation's freshly allocated temporary directory is removed.
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected browser APT temporary directory.");
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareBrowserApt();
  console.log("Browser CI uses official Ubuntu HTTPS mirrors, 60s APT connection/data timeouts and two retries.");
}

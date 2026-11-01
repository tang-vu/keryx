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

function observedSourceUris(uris) {
  const values = uris.slice(0, 4).map(value => value.split(/\s+/).slice(0, 4).map(uri => {
    if (uri === `mirror+file:${mirrorPath}`) return uri;
    try {
      const parsed = new URL(uri);
      if (!["http:", "https:"].includes(parsed.protocol)) return "[unexpected URI scheme]";
      // Runner configuration is public, but never echo URI credentials or queries.
      const path = /^\/ubuntu\/?$/.test(parsed.pathname) ? parsed.pathname : "/[unexpected repository path]";
      return `${parsed.protocol}//${parsed.host}${path}`;
    } catch {
      return "[invalid URI]";
    }
  }));
  return JSON.stringify({ fields: uris.length, values }).slice(0, 1024);
}

export function assertRunnerContext({ env, platform, arch }) {
  if (platform !== "linux" || arch !== "x64" || env.GITHUB_ACTIONS !== "true" ||
      env.RUNNER_ENVIRONMENT !== "github-hosted" || env.RUNNER_OS !== "Linux") {
    throw new Error("Browser APT setup requires a GitHub-hosted Linux x64 runner.");
  }
}

/** Recognize ordinary combined/split Ubuntu stanzas. Preserve their existing
 * metadata while upgrading security to HTTPS and forcing immutable index URLs.
 * https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh
 */
function officialUbuntuSources(sources) {
  const blocks = [];
  let fields = new Map(), current = null, lines = [];
  const finish = () => {
    if (lines.length) blocks.push({ fields, text: lines.join("") });
    fields = new Map(); current = null; lines = [];
  };
  for (const raw of sources.split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, "");
    if (/^[ \t]*$/.test(line)) { finish(); blocks.push({ fields: new Map(), text: raw }); continue; }
    lines.push(raw);
    if (line.startsWith("#")) continue;
    if (!/^[\t\x20-\x7e]*$/.test(line)) return null;
    if (/^[ \t]/.test(line)) {
      if (!current || !line.trim()) return null;
      fields.set(current, `${fields.get(current)} ${line.trim()}`); continue;
    }
    const match = /^([^:\s]+):[ \t]*(.*)$/.exec(line);
    if (!match) return null;
    current = match[1].toLowerCase();
    if (fields.has(current)) return null;
    fields.set(current, match[2].replace(/[ \t]+$/, ""));
  }
  finish();
  const stanzas = blocks.filter(block => block.fields.size).map(block => block.fields);
  if (stanzas.length !== 1 && stanzas.length !== 2) return null;
  const sameTokens = (value, expected) => {
    if (typeof value !== "string") return false;
    const tokens = value.split(/[ \t]+/);
    return tokens.length === expected.length && expected.every(token => tokens.includes(token));
  };
  const allowed = new Set(["types", "uris", "suites", "components", "signed-by", "architectures", "by-hash"]);
  for (const stanza of stanzas) {
    if ([...stanza.keys()].some(key => !allowed.has(key)) || stanza.get("types") !== "deb" ||
        stanza.get("signed-by") !== "/usr/share/keyrings/ubuntu-archive-keyring.gpg" ||
        !sameTokens(stanza.get("components"), ["main", "restricted", "universe", "multiverse"]) ||
        stanza.has("by-hash") && stanza.get("by-hash") !== "force" ||
        stanza.has("architectures") && !sameTokens(stanza.get("architectures"), ["amd64"]) &&
        !sameTokens(stanza.get("architectures"), ["amd64", "i386"])) return null;
  }
  const main = stanzas.filter(stanza => stanza.get("uris") === `mirror+file:${mirrorPath}`);
  const security = stanzas.filter(stanza => /^https?:\/\/security\.ubuntu\.com\/ubuntu\/?$/.test(stanza.get("uris") ?? ""));
  if (main.length !== 1) return null;
  if (stanzas.length === 1) {
    if (security.length || !sameTokens(main[0].get("suites"), ["noble", "noble-updates", "noble-backports", "noble-security"])) return null;
  } else if (security.length !== 1 || !sameTokens(main[0].get("suites"), ["noble", "noble-updates", "noble-backports"]) ||
      security[0].get("suites") !== "noble-security") return null;
  const newline = sources.match(/\r?\n/)?.[0] ?? "\n";
  const immutable = blocks.map(block => {
    if (!block.fields.size || block.fields.has("by-hash")) return block.text;
    return block.text.endsWith("\n") ? `${block.text}By-Hash: force${newline}` : `${block.text}${newline}By-Hash: force`;
  }).join("");
  let replacements = 0;
  const result = immutable.replace(/^(URIs:[ \t]*)http:\/\/security\.ubuntu\.com\/ubuntu(\/?)([ \t]*)(\r?)$/gmi,
    (_, prefix, slash, spaces, carriage) => { replacements++; return `${prefix}https://security.ubuntu.com/ubuntu${slash}${spaces}${carriage}`; });
  if (replacements !== (security[0]?.get("uris").startsWith("http:") ? 1 : 0)) return null;
  return result;
}

/** Fixed hosted-image layout with official Ubuntu endpoints only. Regional EC2
 * names are documented by Canonical cloud-init; no regional URL is used after
 * the plan installs the same two fixed HTTPS endpoints above.
 * https://github.com/canonical/cloud-init/blob/main/config/cloud.cfg.tmpl
 */
function officialRunnerMirrors(mirrors) {
  const rows = mirrors.split(/\r?\n/);
  if (rows.at(-1) === "") rows.pop();
  const parsed = rows.map(row => /^(\S+)[ \t]+priority:([1-3])$/.exec(row.trim()));
  if (parsed.some(row => row === null) || ![2, 3].includes(parsed.length)) return false;
  if (parsed.some((row, index) => row[2] !== String(index + 1))) return false;
  const urls = parsed.map(row => row[1]);
  const official = ["https://archive.ubuntu.com/ubuntu/", "https://security.ubuntu.com/ubuntu/"];
  if (urls.length === 2) return urls.every((url, index) => url === official[index]);
  const primary = /^https?:\/\/(?:azure\.archive\.ubuntu\.com|archive\.ubuntu\.com|(?:af|ap|ca|eu|il|me|mx|sa|us)-(?:[a-z]+-){1,2}[1-9][0-9]*\.ec2\.archive\.ubuntu\.com)\/ubuntu\/?$/;
  return primary.test(urls[0]) && urls.slice(1).every((url, index) => url === official[index]);
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
  const updatedSources = officialUbuntuSources(sources);
  if (updatedSources === null) {
    throw new Error(`Unexpected Ubuntu runner source configuration; refusing to replace mirrors. Observed URI summary: ${observedSourceUris(uris)}`);
  }
  if (mirrors !== runnerMirrors && !officialRunnerMirrors(mirrors)) {
    throw new Error(`Unexpected Ubuntu runner mirror list; refusing to replace mirrors. Observed URI summary: ${observedSourceUris(mirrors.split(/\r?\n/).filter(Boolean))}`);
  }
  if (network !== null && network !== networkConfig) {
    throw new Error("Existing browser APT network configuration is not owned by this setup.");
  }
  return [{ path: mirrorPath, content: httpsMirrors },
    ...(updatedSources !== sources ? [{ path: sourcesPath, content: updatedSources }] : []),
    { path: networkPath, content: networkConfig }];
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
  const input = {
    osRelease: read("/etc/os-release", "utf8"),
    sources: regularFile(sourcesPath), mirrors: regularFile(mirrorPath),
    network: regularFile(networkPath, true),
  };
  const plan = browserAptPlan(input);
  for (const entry of plan) {
    install(entry);
    if (regularFile(entry.path) !== entry.content) throw new Error("Browser APT configuration readback did not match.");
  }
  return {
    format: "keryx-ci-browser-apt-setup-v1",
    initialMirrorUris: JSON.parse(observedSourceUris(input.mirrors.split(/\r?\n/).filter(Boolean)
      .map(line => line.trim().split(/[ \t]+/, 1)[0]))),
    immutableUbuntuIndexes: true,
    configurationReadbackVerified: true,
  };
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
  console.log(JSON.stringify(prepareBrowserApt()));
  console.log("Browser CI uses official Ubuntu HTTPS mirrors, immutable Ubuntu indexes, 60s APT connection/data timeouts and two retries.");
}

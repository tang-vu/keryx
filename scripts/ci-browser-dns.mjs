import { readFileSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { BlockList, isIPv4 } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Only public package-mirror names, on a disposable GitHub-hosted Ubuntu VM.
// Repository URLs, certificate validation, signing keys and APT deadlines stay
// unchanged. DoH is used only when the native NSS lookup actually fails.
const HOSTS = Object.freeze(["archive.ubuntu.com", "security.ubuntu.com", "azure.archive.ubuntu.com"]);
const MARKER = "# keryx-ci-browser-dns-v1";
const privateRanges = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) privateRanges.addSubnet(network, prefix, "ipv4");
const publicAddress = value => typeof value === "string" && isIPv4(value) && !privateRanges.check(value, "ipv4");
function refuse() { throw new Error("Browser mirror DNS recovery unavailable"); }
function hostName(value) { if (!HOSTS.includes(value)) refuse(); return value; }
const name = value => typeof value === "string" ? value.toLowerCase().replace(/\.$/, "") : "";

/** Google's HTTPS JSON DNS protocol; never disables DNSSEC validation.
 * https://developers.google.com/speed/public-dns/docs/doh/json */
export function mirrorDnsAnswers(host, body) {
  hostName(host);
  if (!body || body.Status !== 0 || body.TC !== false || body.CD !== false || !Array.isArray(body.Question)
    || body.Question.length !== 1 || name(body.Question[0].name) !== host || body.Question[0].type !== 1
    || !Array.isArray(body.Answer) || !body.Answer.length || body.Answer.length > 64) refuse();
  const reachable = new Set([host]);
  for (let i = 0; i < 8; i++) for (const row of body.Answer) {
    if (row.type === 5 && reachable.has(name(row.name))) {
      const target = name(row.data);
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(target)) refuse();
      reachable.add(target);
    }
  }
  const answers = body.Answer.filter(row => row.type === 1 && reachable.has(name(row.name)));
  if (!answers.length || answers.length > 16 || answers.some(row => !publicAddress(row.data) || !Number.isInteger(row.TTL) || row.TTL < 1)) refuse();
  return [...new Set(answers.map(row => row.data))].sort();
}

export async function fetchMirrorDns(host, request = fetch) {
  hostName(host);
  const url = new URL("https://dns.google/resolve");
  url.search = new URLSearchParams({ name: host, type: "A", cd: "0", edns_client_subnet: "0.0.0.0/0" }).toString();
  const response = await request(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(5_000) });
  if (!response.ok || !response.body) refuse();
  const reader = response.body.getReader(); let bytes = 0; const parts = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 32_768) refuse(); parts.push(part.value);
    }
    return mirrorDnsAnswers(host, JSON.parse(Buffer.concat(parts).toString("utf8")));
  } catch { await reader.cancel().catch(() => {}); return refuse(); }
}

function nativeLookup(host) {
  const result = spawnSync("getent", ["ahostsv4", host], { encoding: "utf8", timeout: 2_000, maxBuffer: 8192 });
  if (result.error && result.error.code !== "ETIMEDOUT") refuse();
  if (result.error || result.status !== 0) return false;
  const addresses = result.stdout.trim().split(/\n/).map(line => line.trim().split(/\s+/)[0]);
  if (!addresses.length || addresses.some(address => !publicAddress(address))) refuse();
  return true;
}
function appendHosts(content) {
  const result = spawnSync("sudo", ["-n", "tee", "-a", "/etc/hosts"], { input: content, encoding: "utf8", timeout: 10_000, maxBuffer: 8192 });
  if (result.error || result.status !== 0) refuse();
}
export async function prepareBrowserDns({ env = process.env, platform = process.platform, arch = process.arch,
  read = readFileSync, stat = lstatSync, lookup = nativeLookup, request = fetchMirrorDns, append = appendHosts } = {}) {
  if (platform !== "linux" || arch !== "x64" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.RUNNER_OS !== "Linux") refuse();
  const os = read("/etc/os-release", "utf8");
  const field = key => os.split(/\r?\n/).filter(line => line.startsWith(`${key}=`)).map(line => line.slice(key.length + 1).replace(/^"(.*)"$/, "$1"));
  const ids = field("ID"), versions = field("VERSION_ID");
  if (os.length > 8192 || ids.length !== 1 || ids[0] !== "ubuntu" || versions.length !== 1 || !["24.04", "26.04"].includes(versions[0])) refuse();
  const info = stat("/etc/hosts");
  if (!info.isFile() || info.isSymbolicLink() || info.size > 131072) refuse();
  const before = read("/etc/hosts", "utf8");
  const entries = [];
  for (const host of HOSTS) {
    if (lookup(host)) continue;
    // Do not shadow an existing custom/expired hosts-file mapping.
    if (before.split(/\r?\n/).some(line => line.split("#")[0].trim().split(/\s+/).slice(1).includes(host))) refuse();
    const addresses = await request(host);
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 16 || addresses.some(address => !publicAddress(address))) refuse();
    entries.push(...addresses.map(address => `${address}\t${host} ${MARKER}\n`));
  }
  if (entries.length) {
    if (read("/etc/hosts", "utf8") !== before) refuse();
    const suffix = (before.endsWith("\n") ? "" : "\n") + entries.join("");
    append(suffix);
    if (read("/etc/hosts", "utf8") !== before + suffix || HOSTS.some(host => !lookup(host))) refuse();
  }
  return { format: "keryx-ci-browser-dns-v1", recoveredAddresses: entries.length, publicMirrorNamesOnly: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await prepareBrowserDns()));

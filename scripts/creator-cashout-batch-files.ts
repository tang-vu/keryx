import { constants, lstatSync, openSync, readSync, fstatSync, closeSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { inspectWithdrawalRelayDirectory } from "../lib/gateway/withdrawal-relay-files";
import { execFileSync } from "node:child_process";

/** Actual Windows DACL observation, never POSIX mode-bit inference. The parent
 * must already have owner/SYSTEM-only protection; this command changes no ACLs. */
export async function inspectCreatorBatchDirectory(directory: string) {
  if (process.platform === "linux") return inspectWithdrawalRelayDirectory(directory);
  if (process.platform !== "win32" || !isAbsolute(directory) || resolve(directory) !== directory
    || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()
    || realpathSync(directory).toLowerCase() !== directory.toLowerCase()) throw new Error("Protected batch directory unavailable");
  inspectWindowsAcl(directory, false); inspectWindowsAncestors(dirname(directory));
  return directory;
}
function windowsAcl(target: string) {
  const script = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$acl=Get-Acl -LiteralPath $env:KERYX_BATCH_ACL_PATH;"
    + "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
    + "@{current=$sid;attributes=[int](Get-Item -Force -LiteralPath $env:KERYX_BATCH_ACL_PATH).Attributes;trustedInstaller=([Security.Principal.NTAccount]'NT SERVICE\\TrustedInstaller').Translate([Security.Principal.SecurityIdentifier]).Value;owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;"
    + "rules=@($acl.Access|ForEach-Object{@{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;"
    + "type=$_.AccessControlType.ToString();rights=[int]$_.FileSystemRights;propagation=[int]$_.PropagationFlags}})}|ConvertTo-Json -Compress -Depth 4";
  const observed = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", timeout: 10000,
    env: { ...process.env, KERYX_BATCH_ACL_PATH: target }, windowsHide: true })) as {
      current: string; owner: string; attributes: number; trustedInstaller: string; rules: { sid: string; type: string; rights: number; propagation: number }[] };
  if ((observed.attributes & 1024) !== 0) throw new Error("Windows batch reparse path unavailable");
  return observed;
}
function inspectWindowsAcl(target: string, custody: boolean) {
  const observed = windowsAcl(target);
  const allowed = new Set([observed.current, "S-1-5-18", ...(custody ? ["S-1-5-32-544"] : [])]);
  if (observed.owner !== observed.current || !Array.isArray(observed.rules) || !observed.rules.length
    || observed.rules.some(rule => rule.type === "Allow" && !allowed.has(rule.sid))) throw new Error("Private Windows batch ACL unavailable");
}
function inspectWindowsAncestors(parent: string) {
  for (let current = parent; ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(current).toLowerCase() !== current.toLowerCase())
      throw new Error("Private Windows batch ancestry unavailable");
    const acl = windowsAcl(current);
    // Inherit-only ACEs do not apply to this ancestor. Every concrete descendant
    // is separately inspected. Read/traverse rights do not authorize replacement.
    validateCreatorBatchWindowsAncestorAcl(acl, current === dirname(current));
    if (current === dirname(current)) break;
  }
}
export function validateCreatorBatchWindowsAncestorAcl(acl: ReturnType<typeof windowsAcl>, filesystemRoot = false) {
  const trusted = new Set([acl.current, "S-1-5-18", "S-1-5-32-544", acl.trustedInstaller]);
  const replacementRights = filesystemRoot ? 64 | 262144 | 524288 : 2 | 16 | 64 | 256 | 65536 | 262144 | 524288;
  const genericReplacementRights = 0x10000000 | 0x40000000;
  if (!trusted.has(acl.owner) || !Array.isArray(acl.rules) || acl.rules.some(rule => rule.type === "Allow"
    && !(rule.propagation & 2) && !trusted.has(rule.sid)
    && ((rule.rights >>> 0) & (replacementRights | genericReplacementRights)) !== 0))
    throw new Error("Private Windows batch ancestor replacement authority unavailable");
}

/** Private, bounded existing JSON only. Keys and signed records are never printed. */
export async function readCreatorBatchText(file: string, maxBytes = 131072, custody = false): Promise<string> {
  if (!["linux", "win32"].includes(process.platform) || !isAbsolute(file) || resolve(file) !== file) throw new Error("Protected batch file unavailable");
  // A legacy custody parent may be searchable; it must still be immutable by other
  // users. New batch parents always use the stricter withdrawal directory contract.
  if (process.platform === "win32") {
    if (!custody) await inspectCreatorBatchDirectory(dirname(file));
    else inspectWindowsAncestors(dirname(file));
    inspectWindowsAcl(file, custody);
  } else if (!custody) await inspectWithdrawalRelayDirectory(dirname(file));
  else {
    for (let parent = dirname(file); ; parent = dirname(parent)) {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent
        || stat.uid !== process.getuid!() && stat.uid !== 0 || (stat.mode & 0o022) !== 0) throw new Error("Protected custody ancestry unavailable");
      if (parent === dirname(parent)) break;
    }
  }
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > maxBytes
    || process.platform === "linux" && (before.uid !== process.getuid!() || (before.mode & 0o077) !== 0)) throw new Error("Protected batch file unavailable");
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("Batch file changed");
    const bytes = Buffer.alloc(maxBytes + 1); let offset = 0;
    while (offset < bytes.length) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, null); if (!count) break; offset += count; }
    const after = lstatSync(file);
    if (offset !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Batch file changed");
    return bytes.subarray(0, offset).toString("utf8");
  } finally { closeSync(descriptor); }
}
export async function readCreatorBatchJson(file: string, maxBytes = 131072, custody = false): Promise<unknown> {
  return JSON.parse(await readCreatorBatchText(file, maxBytes, custody));
}

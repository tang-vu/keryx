import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const version = "24.21.0";
const archive = `node-v${version}-win-x64.zip`;
// Node.js official SHASUMS256.txt for v24.21.0, win-x64 ZIP.
const archiveHash = "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541";
export const nodeHash = "ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32";
const licenseHash = "ed34dd8e3f0a78dbaf00d0444ce8e285b015b765379c2e17880455f70370f8e9";
const root = resolve(import.meta.dirname, "../..");
const cache = join(root, ".artifacts", "node-runtime");
const archivePath = join(cache, archive);
const extracted = join(cache, `node-v${version}-win-x64`);

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function valid(path, expected) {
  try { return await sha256(path) === expected; } catch { return false; }
}

export async function prepareNodeRuntime(dist) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("The desktop release requires an x64 Windows host");
  }
  await mkdir(cache, { recursive: true });
  if (!(await valid(archivePath, archiveHash))) {
    const response = await fetch(`https://nodejs.org/download/release/v${version}/${archive}`);
    if (!response.ok) throw new Error(`Official Node runtime download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== archiveHash) {
      throw new Error("Official Node runtime ZIP hash differs from pinned SHASUMS256.txt");
    }
    await writeFile(archivePath, bytes);
  }
  const binary = join(extracted, "node.exe");
  const license = join(extracted, "LICENSE");
  if (!(await valid(binary, nodeHash)) || !(await valid(license, licenseHash))) {
    execFileSync("tar.exe", ["-xf", archivePath, "-C", cache], { stdio: "inherit" });
  }
  if (!(await valid(binary, nodeHash)) || !(await valid(license, licenseHash))) {
    throw new Error("Extracted official Node runtime or LICENSE differs from pinned release");
  }
  const destination = join(dist, "runtime");
  await mkdir(destination, { recursive: true });
  await copyFile(binary, join(destination, "node.exe"));
  await copyFile(license, join(destination, "LICENSE"));
  await writeFile(join(destination, "runtime.json"), JSON.stringify({
    vendor: "Node.js", version, architecture: "win-x64", archive,
    archiveSha256: archiveHash, nodeSha256: nodeHash, licenseSha256: licenseHash,
    source: `https://nodejs.org/download/release/v${version}/`,
  }, null, 2) + "\n");
}

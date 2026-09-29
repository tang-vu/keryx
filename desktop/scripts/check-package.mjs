import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyNativeWriterArtifact } from "../../lib/operator/native-writer-artifact.ts";
import { nodeHash } from "./prepare-node-runtime.mjs";

const app = process.argv[2] && resolve(process.argv[2]);
if (!app || process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Verify one unpacked x64 Windows Tauri desktop artifact");
}
const root = resolve(import.meta.dirname, "../..");
const sourceCommit = process.env.KERYX_EXPECTED_SOURCE_COMMIT
  ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Expected exact source commit is missing");
const resource = join(app, "dist");
const exe = join(app, "KeryxOperator.exe");
const executable = await readFile(exe);
if (!executable.subarray(0, 2).equals(Buffer.from("MZ"))) throw new Error("Packaged Tauri executable is not a PE file");
if (!executable.includes(Buffer.from(sourceCommit))) throw new Error("PE does not embed independently expected source commit");
if ((await readFile(join(resource, "source-commit.txt"), "utf8")).trim() !== sourceCommit) {
  throw new Error("Packaged source identity differs from independent checkout revision");
}
const binary = join(resource, "native", "keryx-engine.exe");
const manifest = join(resource, "native", "manifest.json");
await verifyNativeWriterArtifact(binary, manifest, sourceCommit);
const nodeBytes = await readFile(join(resource, "runtime", "node.exe"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
if (hash(nodeBytes) !== nodeHash || !executable.includes(Buffer.from(nodeHash))) {
  throw new Error("Bundled Node runtime differs from the hash pinned in executable and official release");
}
const helper = await readFile(join(resource, "helper.cjs"));
if (!helper.includes(Buffer.from(sourceCommit)) || !executable.includes(Buffer.from(hash(helper)))) {
  throw new Error("Bundled helper is not source-pinned and hash-pinned in executable");
}
const licenses = ["OFL-bodonimoda.txt", "OFL-spectral.txt", "OFL-splinesansmono.txt"];
const sourceAssets = join(root, "desktop", "assets");
const ui = join(resource, "ui");
for (const file of ["icon.png", "fonts/bodoni-moda-latin.woff2", "fonts/spectral-latin-300.woff2",
  "fonts/spectral-latin-400.woff2", "fonts/spectral-latin-500.woff2", "fonts/spectral-latin-600.woff2",
  "fonts/spline-sans-mono-latin.woff2", ...licenses.map((name) => `fonts/${name}`)]) {
  const source = await readFile(join(sourceAssets, file));
  const bundled = await readFile(join(ui, file));
  if (hash(source) !== hash(bundled)) throw new Error(`Bundled visual asset differs from source: ${file}`);
}
const css = await readFile(join(ui, "style.css"), "utf8");
if (!css.includes("bodoni-moda-latin.woff2") || !css.includes("spectral-latin-400.woff2")
  || !css.includes("spline-sans-mono-latin.woff2") || /https?:\/\//i.test(css)) {
  throw new Error("Desktop CSS is missing local fonts or includes a remote URL");
}
for (const forbidden of ["resources", "locales", "swiftshader", "chrome_100_percent.pak", "chrome_200_percent.pak",
  "icudtl.dat", "ffmpeg.dll", "libEGL.dll", "libGLESv2.dll", "electron.exe"]) {
  if ((await readdir(app)).some((entry) => entry.toLowerCase() === forbidden.toLowerCase())) {
    throw new Error(`Electron runtime file remains in Tauri package: ${forbidden}`);
  }
}
const pe = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File",
  join(import.meta.dirname, "check-pe-icon.ps1"), exe, join(sourceAssets, "icon.ico")], { encoding: "utf8" }));
if (pe.productName !== "Keryx Operator" || !pe.iconMatchesCanonical) throw new Error("Keryx PE identity or embedded icon is missing");
let packageBytes = 0;
async function sizeOf(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await sizeOf(path);
    else if (entry.isFile()) packageBytes += (await stat(path)).size;
    else throw new Error(`Unexpected package entry: ${path}`);
  }
}
await sizeOf(app);
console.log(JSON.stringify({ packagedSourceCommit: sourceCommit, nativeWriterVerified: true,
  shell: "Tauri", productName: pe.productName, embeddedIconVerified: true,
  nodeVersion: "24.21.0", nodeSha256: nodeHash, helperSha256: hash(helper),
  executableSha256: hash(executable), executableBytes: executable.length,
  portableUncompressedBytes: packageBytes }));

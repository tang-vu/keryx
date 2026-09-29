import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyNativeWriterArtifact } from "../lib/operator/native-writer-artifact.ts";

const root = resolve(import.meta.dirname, "..");
const dist = join(import.meta.dirname, "dist");
function cleanSourceCommit() {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Cannot identify exact desktop source commit");
  if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim()) {
    throw new Error("Commit source changes before building the desktop release");
  }
  return sha;
}
const sourceCommit = cleanSourceCommit();
const binaryName = process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";
const staged = join(root, ".artifacts", "native-writer");
const binaryPath = join(staged, binaryName);
const manifestPath = join(staged, "manifest.json");
await verifyNativeWriterArtifact(binaryPath, manifestPath, sourceCommit);

if (resolve(dist) !== resolve(import.meta.dirname, "dist")) throw new Error("Invalid desktop build output");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(join(dist, "native"));
await copyFile(binaryPath, join(dist, "native", binaryName));
await copyFile(manifestPath, join(dist, "native", "manifest.json"));
await verifyNativeWriterArtifact(join(dist, "native", binaryName), join(dist, "native", "manifest.json"), sourceCommit);
await writeFile(join(dist, "source-commit.txt"), `${sourceCommit}\n`);
await build({ entryPoints: ["src/main.ts"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"],
  define: { KERYX_NATIVE_SOURCE_COMMIT: JSON.stringify(sourceCommit) },
  outfile: "dist/main.cjs", logLevel: "info" });
await build({ entryPoints: ["src/preload.ts"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"],
  outfile: "dist/preload.cjs", logLevel: "info" });
await build({ entryPoints: ["src/renderer.tsx"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "browser", target: "chrome130", format: "iife", minify: true,
  outfile: "dist/renderer.js", logLevel: "info" });
await copyFile(join(import.meta.dirname, "src/index.html"), join(dist, "index.html"));
await copyFile(join(import.meta.dirname, "src/style.css"), join(dist, "style.css"));
if (cleanSourceCommit() !== sourceCommit) throw new Error("Desktop source changed while building");

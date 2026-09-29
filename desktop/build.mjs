import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, copyFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyNativeWriterArtifact } from "../lib/operator/native-writer-artifact.ts";
import { prepareNodeRuntime } from "./scripts/prepare-node-runtime.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = join(import.meta.dirname, "dist");
const ui = join(dist, "ui");

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
await mkdir(ui, { recursive: true });
await mkdir(join(dist, "native"));
await copyFile(binaryPath, join(dist, "native", binaryName));
await copyFile(manifestPath, join(dist, "native", "manifest.json"));
await verifyNativeWriterArtifact(join(dist, "native", binaryName), join(dist, "native", "manifest.json"), sourceCommit);
await writeFile(join(dist, "source-commit.txt"), `${sourceCommit}\n`);
await prepareNodeRuntime(dist);

await build({ entryPoints: ["src/helper.ts"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "node", target: "node24", format: "cjs",
  define: { KERYX_NATIVE_SOURCE_COMMIT: JSON.stringify(sourceCommit) },
  outfile: "dist/helper.cjs", logLevel: "info" });
await build({ entryPoints: ["src/renderer.tsx"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "browser", target: "chrome110", format: "iife", minify: true,
  outfile: "dist/ui/renderer.js", logLevel: "info" });
await build({ entryPoints: ["src/bridge.ts"], absWorkingDir: import.meta.dirname,
  bundle: true, platform: "browser", target: "chrome110", format: "iife", minify: true,
  outfile: "dist/ui/bridge.js", logLevel: "info" });
await build({ entryPoints: ["src/style.css"], absWorkingDir: import.meta.dirname,
  bundle: true, external: ["*.woff2", "*.png"], minify: true,
  outfile: "dist/ui/style.css", logLevel: "info" });
await copyFile(join(import.meta.dirname, "src/index.html"), join(ui, "index.html"));
await copyFile(join(import.meta.dirname, "assets/icon.png"), join(ui, "icon.png"));
await mkdir(join(ui, "fonts"));
for (const filename of await readdir(join(import.meta.dirname, "assets/fonts"))) {
  if (!/^(?:[a-z0-9-]+\.woff2|OFL-[a-z0-9]+\.txt)$/.test(filename)) throw new Error(`Unexpected font asset: ${filename}`);
  await copyFile(join(import.meta.dirname, "assets/fonts", filename), join(ui, "fonts", filename));
}
if (cleanSourceCommit() !== sourceCommit) throw new Error("Desktop source changed while building");

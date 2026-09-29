/** Build and attest the production writer only from a clean, fixed Git revision. */
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createNativeWriterManifest } from "../lib/operator/native-writer-artifact.ts";

const repo = resolve(import.meta.dirname, "..");
const filename = process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";
const output = join(repo, ".artifacts", "native-writer");

function command(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { cwd: repo, encoding: "utf8", timeout: 600_000,
    maxBuffer: 1_000_000, windowsHide: true, shell: false });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`${executable} failed or did not exit normally: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function cleanRevision() {
  const sourceCommit = command("git", ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Invalid Git source revision");
  if (command("git", ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Native writer build requires a clean checkout, including new source files");
  }
  return sourceCommit;
}

async function main() {
  if (process.argv.length !== 2 || process.arch !== "x64" || !["win32", "linux"].includes(process.platform)) {
    throw new Error("Build requires a clean x64 Linux or Windows checkout and no arguments");
  }
  const sourceCommit = cleanRevision();
  const host = command("rustc", ["-vV"]).split("\n").find(line => line.startsWith("host: "))?.slice(6).trim();
  if (!host || !(process.platform === "linux" && host === "x86_64-unknown-linux-gnu"
    || process.platform === "win32" && ["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu"].includes(host))) {
    throw new Error("Rust host target does not match this x64 platform");
  }
  const target = host as Parameters<typeof createNativeWriterManifest>[1]["target"];
  const buildDirectory = join(repo, ".artifacts", "native-writer-build", sourceCommit);
  command("cargo", ["build", "--manifest-path", "rust/Cargo.toml", "-p", "keryx-engine",
    "--target", target, "--target-dir", buildDirectory, "--release", "--locked"]);
  if (cleanRevision() !== sourceCommit) throw new Error("Source revision changed while building writer");
  const built = join(buildDirectory, target, "release", filename);
  if (!(await stat(built)).isFile()) throw new Error("Native writer build did not produce a regular binary");
  await mkdir(output, { recursive: true });
  const binary = join(output, filename);
  await copyFile(built, binary);
  if (process.platform !== "win32") await chmod(binary, 0o755);
  const manifest = await createNativeWriterManifest(binary, { sourceCommit, target });
  if (cleanRevision() !== sourceCommit) throw new Error("Source revision changed while attesting writer");
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ sourceCommit, target, artifactDirectory: output,
    binaryName: filename, sha256: manifest.sha256 }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Native writer build failed");
  process.exitCode = 1;
});

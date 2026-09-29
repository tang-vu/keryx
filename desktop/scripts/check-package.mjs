import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyNativeWriterArtifact } from "../../lib/operator/native-writer-artifact.ts";

const app = process.argv[2] && resolve(process.argv[2]);
if (!app || process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Verify one unpacked x64 Windows desktop artifact");
}
const sourceCommit = process.env.KERYX_EXPECTED_SOURCE_COMMIT
  ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Expected exact source commit is missing");
const dist = join(app, "resources", "app", "dist");
const binary = join(dist, "native", "keryx-engine.exe");
const manifest = join(dist, "native", "manifest.json");
await verifyNativeWriterArtifact(binary, manifest, sourceCommit);
if ((await readFile(join(dist, "source-commit.txt"), "utf8")).trim() !== sourceCommit
  || !(await readFile(join(dist, "main.cjs"), "utf8")).includes(sourceCommit)) {
  throw new Error("Packaged desktop source identity differs from the independent checkout revision");
}
console.log(JSON.stringify({ packagedSourceCommit: sourceCommit, nativeWriterVerified: true }));

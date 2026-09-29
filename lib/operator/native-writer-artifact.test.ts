import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeWriterManifest, verifyNativeWriterArtifact } from "./native-writer-artifact";

const roots: string[] = [];
const source = "a".repeat(40);
const target = process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
const filename = process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keryx-writer-manifest-")); roots.push(root);
  const binary = join(root, filename); const manifestPath = join(root, "manifest.json");
  await writeFile(binary, "synthetic executable", { mode: 0o700 });
  const manifest = await createNativeWriterManifest(binary, { sourceCommit: source, target });
  await writeFile(manifestPath, JSON.stringify(manifest) + "\n");
  return { binary, manifestPath, manifest };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("pins writer protocol, source revision, target and exact binary bytes", async () => {
  const { binary, manifestPath, manifest } = await fixture();
  expect(await verifyNativeWriterArtifact(binary, manifestPath, source)).toEqual(manifest);
  await expect(verifyNativeWriterArtifact(binary, manifestPath, "b".repeat(40))).rejects.toThrow();
  await writeFile(binary, Buffer.concat([await readFile(binary), Buffer.from("x")]));
  await expect(verifyNativeWriterArtifact(binary, manifestPath, source)).rejects.toThrow();
});

it("refuses altered protocol and unknown manifest keys", async () => {
  const { binary, manifestPath, manifest } = await fixture();
  await writeFile(manifestPath, JSON.stringify({ ...manifest, protocol: "keryx-readonly-cli-v1" }));
  await expect(verifyNativeWriterArtifact(binary, manifestPath, source)).rejects.toThrow();
  await writeFile(manifestPath, JSON.stringify({ ...manifest, extra: "untrusted" }));
  await expect(verifyNativeWriterArtifact(binary, manifestPath, source)).rejects.toThrow();
});

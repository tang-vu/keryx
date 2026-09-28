import { afterEach, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeReadonlyManifest, verifyNativeReadonlyArtifact } from "./native-readonly-artifact";
import { NativeReadonlyTransport } from "./native-readonly-transport";

const roots: string[] = [];
const sourceCommit = "a".repeat(40);
const target = process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
const binaryName = process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keryx-native-artifact-"));
  roots.push(root);
  const binary = join(root, binaryName);
  const manifestPath = join(root, "manifest.json");
  await writeFile(binary, "synthetic executable bytes", { mode: 0o700 });
  const manifest = await createNativeReadonlyManifest(binary, { sourceCommit, target });
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return { root, binary, manifestPath, manifest };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("pins exact bytes and explicit source/host identity without claiming binary authenticity", async () => {
  const { binary, manifestPath, manifest } = await fixture();
  expect(await verifyNativeReadonlyArtifact(binary, manifestPath, sourceCommit)).toEqual(manifest);
  await expect(verifyNativeReadonlyArtifact(binary, manifestPath, "b".repeat(40)))
    .rejects.toThrow(/expected source or host/);
  await writeFile(binary, "synthetic executable bytex");
  await expect(verifyNativeReadonlyArtifact(binary, manifestPath, sourceCommit))
    .rejects.toThrow(/does not match the trusted manifest/);
});

it("refuses unknown manifest fields, incompatible target, invalid UTF-8 and oversized metadata", async () => {
  const { root, binary, manifestPath, manifest } = await fixture();
  await writeFile(manifestPath, JSON.stringify({ ...manifest, privateKey: "should not be here" }));
  await expect(verifyNativeReadonlyArtifact(binary, manifestPath, sourceCommit))
    .rejects.toThrow(/Invalid native artifact manifest/);
  await writeFile(manifestPath, JSON.stringify({ ...manifest, platform: process.platform === "win32" ? "linux" : "win32" }));
  await expect(verifyNativeReadonlyArtifact(binary, manifestPath, sourceCommit))
    .rejects.toThrow(/target does not match this host/);
  const wrongName = process.platform === "win32" ? "keryx-engine" : "keryx-engine.exe";
  const renamed = join(root, wrongName);
  await copyFile(binary, renamed);
  await writeFile(manifestPath, JSON.stringify({ ...manifest, binaryName: wrongName }));
  await expect(verifyNativeReadonlyArtifact(renamed, manifestPath, sourceCommit))
    .rejects.toThrow(/expected source or host/);
  await writeFile(manifestPath, Buffer.from([0xff]));
  await expect(verifyNativeReadonlyArtifact(binary, manifestPath, sourceCommit))
    .rejects.toThrow(/Invalid native artifact manifest/);
  await writeFile(manifestPath, Buffer.alloc(4097, 65));
  await expect(verifyNativeReadonlyArtifact(binary, manifestPath, sourceCommit))
    .rejects.toThrow(/bounded regular/);
});

it("cancels before any artifact or process access", async () => {
  const { root } = await fixture();
  const controller = new AbortController();
  controller.abort();
  const transport = new NativeReadonlyTransport({
    binaryPath: join(root, "missing-binary"), manifestPath: join(root, "missing-manifest"),
    expectedSourceCommit: sourceCommit,
  });
  await expect(transport.inspect("status", join(root, "state"), controller.signal))
    .rejects.toThrow(/canceled before launch/);
});

it("snapshots artifact identity and byte limits before caller option mutation", async () => {
  const { root, binary, manifestPath } = await fixture();
  const config = { binaryPath: binary, manifestPath, expectedSourceCommit: sourceCommit, maxStdoutBytes: 128 };
  const transport = new NativeReadonlyTransport(config);
  config.binaryPath = join(root, "missing-binary");
  config.manifestPath = join(root, "missing-manifest");
  config.maxStdoutBytes = 100_000_000;
  await expect(transport.inspect("status", join(root, "task")))
    .rejects.toMatchObject({ phase: "protocol" });
});

it("requires an explicit source claim and exact binary filename when creating a manifest", async () => {
  const { binary, manifestPath } = await fixture();
  const original = await readFile(binary);
  expect(original.length).toBeGreaterThan(0);
  await expect(createNativeReadonlyManifest(binary, { sourceCommit: "not-a-commit", target }))
    .rejects.toThrow();
  await expect(createNativeReadonlyManifest(manifestPath, { sourceCommit, target }))
    .rejects.toThrow(/filename/);
});

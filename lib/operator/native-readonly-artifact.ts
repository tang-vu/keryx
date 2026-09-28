import { createHash } from "node:crypto";
import { open, lstat } from "node:fs/promises";
import { isAbsolute, basename } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";

export const NATIVE_READONLY_PROTOCOL = "keryx-readonly-cli-v1" as const;
const MAX_MANIFEST_BYTES = 4096;
const MAX_BINARY_BYTES = 64 * 1024 * 1024;
const sourceCommit = z.string().regex(/^[a-f0-9]{40}$/);
const target = z.enum(["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu", "x86_64-unknown-linux-gnu"]);
const manifestSchema = z.object({
  schema: z.literal("keryx-native-readonly-artifact-v1"),
  protocol: z.literal(NATIVE_READONLY_PROTOCOL),
  engine: z.literal("keryx-engine"),
  sourceCommit,
  platform: z.enum(["win32", "linux"]),
  arch: z.literal("x64"),
  target,
  binaryName: z.enum(["keryx-engine.exe", "keryx-engine"]),
  sizeBytes: z.number().int().positive().max(MAX_BINARY_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type NativeReadonlyManifest = z.infer<typeof manifestSchema>;

function requireAbsolute(path: string, label: string) {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
}

function requireHost(targetTriple: NativeReadonlyManifest["target"], platform: string, arch: string) {
  if (arch !== "x64" || !(
    platform === "win32" && ["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu"].includes(targetTriple)
    || platform === "linux" && targetTriple === "x86_64-unknown-linux-gnu"
  )) throw new Error("Native artifact target does not match this host");
}

async function regularFile(path: string, limit: number, executable: boolean) {
  requireAbsolute(path, "Native artifact path");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > limit
    || executable && process.platform !== "win32" && (stat.mode & 0o111) === 0) {
    throw new Error("Native artifact must be a bounded regular executable file");
  }
  return stat;
}

async function hashBinary(path: string) {
  const initial = await regularFile(path, MAX_BINARY_BYTES, true);
  const file = await open(path, "r");
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size !== initial.size || opened.size > MAX_BINARY_BYTES
      || opened.dev !== initial.dev || opened.ino !== initial.ino) {
      throw new Error("Native binary changed before verification");
    }
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(64 * 1024);
    let size = 0;
    while (size <= MAX_BINARY_BYTES) {
      const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, MAX_BINARY_BYTES + 1 - size), null);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      size += bytesRead;
    }
    const after = await file.stat();
    const entry = await lstat(path);
    if (size !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || after.dev !== opened.dev || after.ino !== opened.ino || !entry.isFile() || entry.isSymbolicLink()
      || entry.dev !== opened.dev || entry.ino !== opened.ino) {
      throw new Error("Native binary changed during verification");
    }
    return { sha256: hash.digest("hex"), sizeBytes: size };
  } finally {
    await file.close();
  }
}

export async function createNativeReadonlyManifest(binaryPath: string, metadata: {
  sourceCommit: string; target: NativeReadonlyManifest["target"];
}): Promise<NativeReadonlyManifest> {
  sourceCommit.parse(metadata.sourceCommit);
  target.parse(metadata.target);
  requireHost(metadata.target, process.platform, process.arch);
  const binaryName = process.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";
  if (basename(binaryPath) !== binaryName) throw new Error("Native binary filename does not match its target");
  const hash = await hashBinary(binaryPath);
  return manifestSchema.parse({ schema: "keryx-native-readonly-artifact-v1", protocol: NATIVE_READONLY_PROTOCOL,
    engine: "keryx-engine", sourceCommit: metadata.sourceCommit, platform: process.platform,
    arch: process.arch, target: metadata.target, binaryName, ...hash });
}

export async function verifyNativeReadonlyArtifact(binaryPath: string, manifestPath: string,
  expectedSourceCommit: string): Promise<NativeReadonlyManifest> {
  sourceCommit.parse(expectedSourceCommit);
  const stat = await regularFile(manifestPath, MAX_MANIFEST_BYTES, false);
  const file = await open(manifestPath, "r");
  let bytes: Buffer;
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size !== stat.size || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error("Native manifest changed before verification");
    }
    bytes = Buffer.alloc(opened.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await file.stat();
    const entry = await lstat(manifestPath);
    if (size !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || after.dev !== opened.dev || after.ino !== opened.ino || !entry.isFile() || entry.isSymbolicLink()
      || entry.dev !== opened.dev || entry.ino !== opened.ino) {
      throw new Error("Native manifest changed during verification");
    }
    bytes = bytes.subarray(0, size);
  } finally {
    await file.close();
  }
  let manifest: NativeReadonlyManifest;
  try { manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); }
  catch { throw new Error("Invalid native artifact manifest"); }
  requireHost(manifest.target, manifest.platform, manifest.arch);
  const expectedName = manifest.platform === "win32" ? "keryx-engine.exe" : "keryx-engine";
  if (manifest.platform !== process.platform || manifest.arch !== process.arch
    || manifest.sourceCommit !== expectedSourceCommit || manifest.binaryName !== expectedName
    || basename(binaryPath) !== expectedName) {
    throw new Error("Native artifact identity does not match the expected source or host");
  }
  const actual = await hashBinary(binaryPath);
  if (actual.sha256 !== manifest.sha256 || actual.sizeBytes !== manifest.sizeBytes) {
    throw new Error("Native binary does not match the trusted manifest");
  }
  return manifest;
}

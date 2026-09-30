import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../canonical-json";
import { STORAGE_TESTNET_PROFILE_DIGEST } from "./storage-identity";
import { readRuntimeStorageDeployment, RuntimeStorageRefused, STORAGE_MANIFEST_MAX_BYTES } from "./runtime-storage-config";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const identity = { format: "keryx-storage-identity-v1", deploymentId: "11111111-1111-4111-8111-111111111111",
  storageId: "22222222-2222-4222-8222-222222222222", enrollmentId: "33333333-3333-4333-8333-333333333333",
  network: "eip155:5042002", authorityMode: "testnet-real", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
  enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "aa".repeat(32) };
function fixture(backend?: unknown, selectedIdentity = identity) {
  const folder = mkdtempSync(join(tmpdir(), "keryx-storage-manifest-")); folders.push(folder);
  const store = join(folder, "synthetic.sqlite"), path = join(folder, "manifest.json");
  writeFileSync(store, "synthetic-existing-file");
  const document = { format: "keryx-storage-deployment-v1", identity: selectedIdentity, backend: backend ?? { kind: "sqlite", databasePath: store } };
  writeFileSync(path, canonicalJson(document) + "\n");
  return { folder, path, store, document, env: { KERYX_STORAGE_MANIFEST: path } };
}
function refused(env: Record<string, string | undefined>) {
  try { readRuntimeStorageDeployment(env); expect.fail("configuration accepted"); }
  catch (error) { expect(error).toBeInstanceOf(RuntimeStorageRefused); expect((error as Error).message).toBe("Storage deployment configuration unavailable"); }
}
describe("explicit server storage deployment manifest", () => {
  it("retains full exact identity and explicit SQLite target, independent of unrelated credentials/keys", () => {
    const f = fixture(), before = readFileSync(f.store);
    const result = readRuntimeStorageDeployment({ ...f.env, NEXT_PUBLIC_SUPABASE_URL: "https://unrelated.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic",
      FUNDER_PRIVATE_KEY: "synthetic-present", ANTHROPIC_API_KEY: "synthetic-present" });
    expect(result).toEqual(f.document); expect(Object.isFrozen(result.identity)).toBe(true); expect(Object.isFrozen(result.backend)).toBe(true);
    expect(readFileSync(f.store)).toEqual(before);
  });
  it("allows real read-only configuration without treasury keys", () => { expect(readRuntimeStorageDeployment(fixture().env).identity.authorityMode).toBe("testnet-real"); });
  it("uses offline identity independently of absent or present signing/LLM keys", () => {
    const f = fixture(undefined, { ...identity, authorityMode: "testnet-offline" });
    expect(readRuntimeStorageDeployment({ ...f.env, FUNDER_PRIVATE_KEY: "synthetic" }).identity.authorityMode).toBe("testnet-offline");
  });
  it("refuses missing/relative/unavailable manifest without target creation", () => {
    refused({}); refused({ KERYX_STORAGE_MANIFEST: "manifest.json" });
    const f = fixture(); refused({ KERYX_STORAGE_MANIFEST: join(f.folder, "missing.json") });
  });
  it("rejects symlink manifest and symlink ancestors", () => {
    const f = fixture(); const alias = join(f.folder, "alias");
    symlinkSync(f.folder, alias, process.platform === "win32" ? "junction" : "dir"); refused({ KERYX_STORAGE_MANIFEST: join(alias, "manifest.json") });
  });
  it("bounds bytes before reading oversized documents", () => { const f = fixture(); writeFileSync(f.path, "x".repeat(STORAGE_MANIFEST_MAX_BYTES + 1)); refused(f.env); });
  it.each(["{bad", "{}", "null", "[]"])("rejects malformed or incomplete document %s", text => { const f = fixture(); writeFileSync(f.path, text); refused(f.env); });
  it("rejects ambiguous duplicate keys and noncanonical wire JSON", () => {
    const f = fixture(); writeFileSync(f.path, canonicalJson(f.document).replace('"format":"keryx-storage-deployment-v1"', '"format":"foreign","format":"keryx-storage-deployment-v1"')); refused(f.env);
    writeFileSync(f.path, JSON.stringify(f.document, null, 2)); refused(f.env);
  });
  it("rejects unknown identity/document fields, foreign profile/network and secret-bearing fields", () => {
    const f = fixture();
    for (const document of [{ ...f.document, secret: "private-credential" },
      { ...f.document, identity: { ...identity, network: "eip155:5042" } },
      { ...f.document, identity: { ...identity, profileDigest: "00".repeat(32) } }]) { writeFileSync(f.path, canonicalJson(document)); refused(f.env); }
  });
  it("rejects forced offline on real identity and invalid flags", () => {
    const f = fixture(); refused({ ...f.env, KERYX_FORCE_OFFLINE: "1" }); refused({ ...f.env, KERYX_FORCE_OFFLINE: "invalid" });
    expect(readRuntimeStorageDeployment({ ...f.env, KERYX_FORCE_OFFLINE: "0" }).identity.authorityMode).toBe("testnet-real");
  });
  it("refuses SQLite path overrides/missing selected targets", () => {
    const f = fixture(); refused({ ...f.env, KERYX_SQLITE_PATH: join(f.folder, "other.sqlite") });
    writeFileSync(f.path, canonicalJson({ ...f.document, backend: { kind: "sqlite", databasePath: join(f.folder, "missing.sqlite") } })); refused(f.env);
  });
  it("requires exact Supabase HTTPS origin and selected credential, never falls back", () => {
    const f = fixture({ kind: "supabase", url: "https://selected.supabase.co" });
    refused(f.env); refused({ ...f.env, NEXT_PUBLIC_SUPABASE_URL: "https://selected.supabase.co" });
    refused({ ...f.env, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic" });
    expect(readRuntimeStorageDeployment({ ...f.env, NEXT_PUBLIC_SUPABASE_URL: "https://selected.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic" }).backend)
      .toEqual({ kind: "supabase", url: "https://selected.supabase.co" });
  });
  it.each(["http://selected.supabase.co", "https://selected.supabase.co/", "https://credential:private@selected.supabase.co", "https://selected.supabase.co?token=private"])
    ("refuses noncanonical or credential-bearing backend URL", url => { const f = fixture({ kind: "supabase", url }); refused({ ...f.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "synthetic" }); });
});

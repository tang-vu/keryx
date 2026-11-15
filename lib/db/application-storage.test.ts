import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import type { KeryxDB } from "./keryx-db";
import type { StorageDeploymentManifest } from "./runtime-storage-config";

const folders: string[] = [], closers: Array<() => void> = [];
function isolatedEnvironment() {
  for (const [name, value] of Object.entries({ KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
    KERYX_FORCE_OFFLINE: "1", KERYX_SQLITE_PATH: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
    KERYX_STORAGE_MANIFEST: "", CONTENT_MASTER_KEY: "aa".repeat(32), KERYX_RUN_PRIVACY_ENABLED: "false",
    KERYX_RUN_CLAIMS_ENABLED: "false", KERYX_PUBLIC_PROFILES_ENABLED: "false" })) vi.stubEnv(name, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Identity checks must not access the network"); }));
}
beforeAll(async () => {
  // Transform the real enrollment/runtime dependency graph once, separately
  // from each bounded fixture's DB checks. No facade or authority is created.
  isolatedEnvironment();
  await import("./application-storage");
  await import("./sqlite-application-schema");
  await import("./storage-identity-provision");
});
beforeEach(() => {
  vi.resetModules(); isolatedEnvironment();
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) close();
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !basename(folder).startsWith("keryx-application-identity-")) throw new Error("Unsafe identity fixture cleanup");
    rmSync(folder, { recursive: true, force: true });
  }
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
async function selection(kind: "sqlite" | "supabase" | "postgres") {
  const folder = mkdtempSync(join(tmpdir(), "keryx-application-identity-")); folders.push(folder);
  const file = join(folder, "source.sqlite"), manifestPath = join(folder, "deployment.json");
  const { syntheticStorageIdentity } = await import("./storage-identity-fixture");
  const identity = syntheticStorageIdentity("testnet-offline");
  const backend: StorageDeploymentManifest["backend"] = kind === "sqlite" ? { kind, databasePath: file }
    : kind === "supabase" ? { kind, url: "https://application-identity-fixture.invalid" }
    : { kind, database: "identity_fixture", sourceDigest: "ab".repeat(32), endpoint: { kind: "loopback", port: 5432 },
      credentialPaths: { application: join(folder, "application.json"), reader: join(folder, "reader.json") } };
  const deployment: StorageDeploymentManifest = { format: "keryx-storage-deployment-v1", identity, backend };
  writeFileSync(manifestPath, canonicalJson(deployment)); vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath);
  if (kind === "sqlite") vi.stubEnv("KERYX_SQLITE_PATH", file);
  if (kind === "supabase") { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", backend.kind === "supabase" ? backend.url : ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-network-key"); }
  return { file, manifestPath, deployment, identity };
}
async function enrolledSqlite() {
  const f = await selection("sqlite"), db = new DatabaseSync(f.file);
  const { installSqliteApplicationSchema } = await import("./sqlite-application-schema");
  try { db.exec("BEGIN IMMEDIATE"); installSqliteApplicationSchema(db); db.exec("COMMIT"); } finally { db.close(); }
  const { inspectSqliteEnrollment, enrollSqliteStorage } = await import("./storage-identity-provision");
  const inspection = await inspectSqliteEnrollment(f.file, f.identity);
  await enrollSqliteStorage(f.file, f.identity, { format: "keryx-reviewed-storage-enrollment-v1", inspection,
    provenanceDocumentDigest: f.identity.provenanceDigest, unknownClassAttestation: inspection.unknownClasses });
  const enrolled = await import("./enrolled-sqlite-adapter"), app = await import("./application-storage");
  const writer = await enrolled.createEnrolledSqliteAdapter(); closers.push(() => writer.close());
  const reader = await enrolled.createReadonlyEnrolledSqliteAdapter(); closers.push(() => reader.close());
  return { ...f, app, writer, reader };
}

it("awaits genuine enrolled Source identities while preserving the synchronous SQLite API", async () => {
  const f = await enrolledSqlite();
  const syncIdentity = f.app.applicationSqliteIdentity(f.writer, "write");
  expect(syncIdentity).toEqual(f.identity); expect(syncIdentity).not.toBeInstanceOf(Promise);
  await expect(f.app.applicationStorageIdentity(f.writer)).resolves.toEqual(f.identity);
  await expect(f.app.applicationStorageIdentity(f.writer, "write")).resolves.toEqual(f.identity);
  await expect(f.app.applicationStorageIdentity(f.reader)).resolves.toEqual(f.identity);
  await expect(f.app.applicationStorageIdentity(f.reader, "write")).rejects.toThrow("Enrolled SQLite adapter unavailable");
  f.writer.close(); f.reader.close();
  for (const db of [f.writer, f.reader]) for (const access of ["read", "write"] as const) await expect(f.app.applicationStorageIdentity(db, access)).rejects.toThrow();
});
it("refuses raw cores, wrapped facades and changed selected manifests without fallback", async () => {
  const f = await enrolledSqlite(), raw = new DatabaseSync(f.file, { readOnly: true }); closers.push(() => raw.close());
  const { SqliteAdapter } = await import("./sqlite-adapter");
  const core = SqliteAdapter.assembleConnectionCore(raw, f.identity, () => {});
  for (const candidate of [core, new Proxy(f.writer, {}), Object.create(f.writer)]) await expect(f.app.applicationStorageIdentity(candidate)).rejects.toThrow("Enrolled SQLite adapter unavailable");
  writeFileSync(f.manifestPath, canonicalJson({ ...f.deployment, identity: { ...f.identity, provenanceDigest: "b".repeat(64) } }));
  await expect(f.app.applicationStorageIdentity(f.writer, "write")).rejects.toThrow("Storage deployment configuration unavailable");
  await expect(f.app.applicationStorageIdentity(f.reader)).rejects.toThrow("Storage deployment configuration unavailable");
});
it.each(["postgres", "supabase"] as const)("routes only by the pinned %s selection and refuses claimed method provenance", async kind => {
  const f = await selection(kind), app = await import("./application-storage");
  const sqlite = await import("./enrolled-sqlite-adapter"), sqliteGuard = vi.spyOn(sqlite, "assertEnrolledSqliteAdapter");
  let inspected = 0;
  const forged = new Proxy({ identity: f.identity, guard: async () => {}, closed: false }, { get() { inspected++; throw new Error("Caller method presence is not authority"); } }) as unknown as KeryxDB;
  for (const access of ["read", "write"] as const) await expect(app.applicationStorageIdentity(forged, access)).rejects.toThrow("adapter_not_initialized");
  expect(inspected).toBe(0); expect(sqliteGuard).not.toHaveBeenCalled();
  if (kind === "supabase") {
    const { SupabaseAdapter } = await import("./supabase-adapter");
    await expect(app.applicationStorageIdentity(new SupabaseAdapter())).rejects.toThrow("adapter_not_initialized");
  } else {
    const native = await import("./postgres/runtime-adapter");
    await expect(native.createPostgresRuntimeAdapter()).rejects.toThrow("adapter_not_initialized");
  }
});
it("waits for the actual native guard and propagates its refusal without another backend attempt", async () => {
  await selection("postgres"); const native = await import("./postgres/runtime-adapter"), original = native.assertPostgresRuntimeIdentity;
  let release!: () => void; const gate = new Promise<void>(done => { release = done; });
  const guard = vi.spyOn(native, "assertPostgresRuntimeIdentity").mockImplementation(async (db, access) => { await gate; return original(db, access); });
  const supabase = await import("./enrolled-supabase-adapter"), fallback = vi.spyOn(supabase, "assertEnrolledSupabaseAuthority");
  const app = await import("./application-storage"), core = Object.freeze({}) as KeryxDB;
  let settled = false; const result = app.applicationStorageIdentity(core, "write").finally(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false); expect(guard.mock.calls[0][0] === core).toBe(true); expect(guard.mock.calls[0][1]).toBe("write");
  release(); await expect(result).rejects.toThrow("adapter_not_initialized"); expect(fallback).not.toHaveBeenCalled();
});
it("refuses invalid access and injected arguments before inspecting a facade or selecting storage", async () => {
  const app = await import("./application-storage"), db = new Proxy({}, { get() { throw new Error("Must not inspect facade"); } }) as KeryxDB;
  await expect(Reflect.apply(app.applicationStorageIdentity, undefined, [db, "admin"])).rejects.toThrow("invalid_operation");
  await expect(Reflect.apply(app.applicationStorageIdentity, undefined, [db, "read", () => true])).rejects.toThrow("invalid_operation");
});

it("narrows genuine SQLite facades synchronously without returning identity or write authority", async () => {
  const f = await enrolledSqlite();
  expect(f.app.assertApplicationStorageCurrentLocal(f.writer, "write")).toBeUndefined();
  expect(f.app.assertApplicationStorageCurrentLocal(f.reader, "read")).toBeUndefined();
  expect(() => f.app.assertApplicationStorageCurrentLocal(f.reader, "write")).toThrow("Enrolled SQLite adapter unavailable");
  for (const fake of [{}, new Proxy(f.writer, {}), Object.create(f.writer)])
    expect(() => f.app.assertApplicationStorageCurrentLocal(fake as KeryxDB)).toThrow();
  f.writer.close();
  expect(() => f.app.assertApplicationStorageCurrentLocal(f.writer)).toThrow();
  writeFileSync(f.manifestPath, canonicalJson({ ...f.deployment, identity: { ...f.identity, provenanceDigest: "b".repeat(64) } }));
  expect(() => f.app.assertApplicationStorageCurrentLocal(f.reader)).toThrow();
});
it.each(["supabase", "postgres"] as const)("local narrowing keeps %s fabricated admission closed", async kind => {
  await selection(kind); const app = await import("./application-storage");
  let getters = 0; const fake = new Proxy({}, { get() { getters++; throw new Error("Must not inspect caller methods"); } }) as KeryxDB;
  expect(() => app.assertApplicationStorageCurrentLocal(fake, "write")).toThrow("adapter_not_initialized");
  expect(() => Reflect.apply(app.assertApplicationStorageCurrentLocal, undefined, [fake, "read", () => true])).toThrow("invalid_operation");
  expect(() => Reflect.apply(app.assertApplicationStorageCurrentLocal, undefined, [fake, "admin"])).toThrow("invalid_operation");
  expect(getters).toBe(0);
});
it("does not mistake a Promise-returning native local hook for a completed narrowing check", async () => {
  await selection("postgres"); const native = await import("./postgres/runtime-adapter");
  // Negative dependency contract only; this creates no enrolled native facade.
  vi.spyOn(native, "assertPostgresRuntimeCurrentLocal").mockImplementation((() => Promise.resolve()) as unknown as typeof native.assertPostgresRuntimeCurrentLocal);
  const app = await import("./application-storage");
  expect(() => app.assertApplicationStorageCurrentLocal({} as KeryxDB)).toThrow("invalid_operation");
});

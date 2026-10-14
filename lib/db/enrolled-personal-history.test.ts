import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { createSqliteStorage } from "./storage-identity-provision";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { createHistoryRoute } from "../history/personal-history-route";

const owner = `0x${"11".repeat(20)}`, other = `0x${"22".repeat(20)}`;
const date = "2026-10-14T00:00:00.000Z";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.unstubAllEnvs(); });

async function fixture() {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-synthetic-enrolled-history-"));
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "synthetic.sqlite"), manifestPath = join(folder, "deployment.json");
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(),
    storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: date, provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(file, identity);
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const { supportedSqliteApplicationProfiles } = await import("./enrolled-sqlite-schema-profile");
  const seed = openVerifiedSqliteStorage(file, identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) });
  const raw = seed.db;
  try {
    const insert = raw.prepare(`INSERT INTO query_runs(id,created_at,question,asker,data,total_spent,total_to_creators,payment_mode,answer)
      VALUES(?,?,?,?,?,0,0,'offline','SYNTHETIC PRIVATE ANSWER')`);
    for (const [id, wallet] of [["owner_a", owner], ["owner_b", other]]) insert.run(id, date, `Synthetic ${id}`, wallet,
      JSON.stringify({ asker: wallet, askerFunded: false, privateArtifact: "SYNTHETIC HIDDEN ARTIFACT" }));
    const payment = raw.prepare(`INSERT INTO payment_events(id,created_at,query_id,kind,source_id,source_name,payer,payee,
      amount_usdc,network,tx_hash,settled,settlement_status,authorization_phase) VALUES(?,?,?,'fetch','synthetic-source',
      'Synthetic source',?,?,0.001,'eip155:5042',?,?,?,?)`);
    payment.run("settled", date, "owner_a", owner, other, "synthetic-not-a-real-transfer", 1, "settled", null);
    payment.run("prepared", date, "owner_a", owner, other, null, 0, "pending", "prepared");
    payment.run("cancelled", date, "owner_a", owner, other, null, 0, "failed", "cancelled_unexposed");
  } finally { seed.close(); }
  const manifest = canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } });
  writeFileSync(manifestPath, manifest);
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  const api = await import("./enrolled-sqlite-adapter");
  const adapter = await api.createEnrolledSqliteAdapter(); cleanup.push(() => adapter.close());
  const personal = await import("./personal-history-sqlite");
  return { file, manifestPath, manifest, identity, adapter, api, personal };
}

it("serves the actual authenticated history route from the native facade without exposing answers or foreign rows", async () => {
  const f = await fixture();
  const route = createHistoryRoute({ session: async () => ({ db: f.adapter, wallet: owner }),
    key: async () => { throw new Error("Cookie must not use bearer authority"); }, db: async () => f.adapter, network: "eip155:5042" });
  const response = await route(new Request("https://keryx.example/api/me/history", { headers: { "X-Keryx-Expected-Wallet": owner } }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.json(); expect(body.wallet).toBe(owner); expect(body.rows.map((row: { id: string }) => row.id)).toEqual(["owner_a"]);
  expect(JSON.stringify(body)).not.toMatch(/owner_b|PRIVATE ANSWER|HIDDEN ARTIFACT/);
  expect((await f.adapter.personalHistory!.list(other, { filters: {}, take: 1 })).map(row => row.id)).toEqual(["owner_b"]);
  expect(Object.isFrozen(f.adapter.personalHistory)).toBe(true);
  expect(Object.getOwnPropertyDescriptor(f.adapter, "personalHistory")?.enumerable).toBe(false);
});

it("reads the same existing projection through a genuinely readonly native connection and changes no bytes", async () => {
  const f = await fixture(), before = readFileSync(f.file);
  const readonly = await f.api.createReadonlyEnrolledSqliteAdapter(); cleanup.push(() => readonly.close());
  expect((await readonly.personalHistory!.list(owner, { filters: {}, take: 51 })).map(row => row.id)).toEqual(["owner_a"]);
  expect((await readonly.personalHistory!.receipts!("owner_a", 201)).map(row => row.id)).toEqual(["settled"]);
  expect(readFileSync(f.file)).toEqual(before);
  expect(() => readonly.setSyncState("forbidden", "write")).toThrow(/Readonly/);
});

it("refuses raw/ordinary authority and preserves the ordinary constructor's enrolled refusal", async () => {
  const f = await fixture(), raw = new DatabaseSync(f.file);
  try {
    expect(() => f.personal.createEnrolledSqlitePersonalHistory(raw)).toThrow("history_unavailable");
    await expect(f.personal.createSqlitePersonalHistory(raw).list(owner, { filters: {}, take: 1 })).rejects.toThrow(/enrolled/);
  } finally { raw.close(); }
});

it("refuses an old port after manifest drift, even if the old manifest is restored", async () => {
  const f = await fixture(), port = f.adapter.personalHistory!;
  writeFileSync(f.manifestPath, "{}");
  await expect(port.list(owner, { filters: {}, take: 1 })).rejects.toThrow("history_unavailable");
  writeFileSync(f.manifestPath, f.manifest);
  await expect(port.receipts!("owner_a", 1)).rejects.toThrow("history_unavailable");
});

it("refuses a retained port after its verified connection closes", async () => {
  const f = await fixture(), port = f.adapter.personalHistory!; f.adapter.close();
  await expect(port.list(owner, { filters: {}, take: 1 })).rejects.toThrow("history_unavailable");
});

it("also retires the port when an internal verified statement guard refuses after the initial precheck", async () => {
  const f = await fixture();
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const { supportedSqliteApplicationProfiles } = await import("./enrolled-sqlite-schema-profile");
  let calls = 0, refuseAt = Infinity;
  const connection = openVerifiedSqliteStorage(f.file, f.identity, { readOnly: true,
    applicationProfiles: supportedSqliteApplicationProfiles(true),
    runtimeGuard: () => { if (++calls === refuseAt) throw new Error("Synthetic internal provenance refusal"); } });
  cleanup.push(connection.close);
  const port = f.personal.createEnrolledSqlitePersonalHistory(connection.db);
  refuseAt = calls + 2;
  await expect(port.list(owner, { filters: {}, take: 1 })).rejects.toThrow("Synthetic internal provenance refusal");
  refuseAt = Infinity; const afterFailure = calls;
  await expect(port.list(owner, { filters: {}, take: 1 })).rejects.toThrow("history_unavailable");
  await expect(port.receipts!("owner_a", 1)).rejects.toThrow("history_unavailable");
  expect(calls).toBe(afterFailure);
});

it("retains bounded list and receipt failure paths on the native port", async () => {
  const f = await fixture(), port = f.adapter.personalHistory!;
  for (const take of [0, 52, 1.5]) await expect(port.list(owner, { filters: {}, take })).rejects.toThrow("history_unavailable");
  for (const take of [0, 202, 1.5]) await expect(port.receipts!("owner_a", take)).rejects.toThrow("history_unavailable");
  await expect(port.list("invalid-wallet", { filters: {}, take: 1 })).rejects.toThrow();
  expect((await port.list(owner, { filters: {}, take: 1 }))[0].id).toBe("owner_a");
});

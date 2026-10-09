import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { inspectSqliteEnrollment, enrollSqliteStorage } from "../db/storage-identity-provision";
import { readOperatorLedger } from "./read";
import { ledgerRun, ledgerPayment, LEDGER_FIXTURE_TIME } from "./test-fixture";

afterEach(() => vi.unstubAllEnvs());

it("reads the actual sealed native facade without migration/writes or private journal fallback", async () => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-public-ledger-native-"));
  expect(resolve(folder).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  const path = join(folder, "offline-fixture.sqlite"), manifest = join(folder, "deployment.json"), identity = syntheticStorageIdentity("testnet-offline");
  const raw = new DatabaseSync(path);
  try {
    raw.exec("BEGIN IMMEDIATE"); installSqliteApplicationSchema(raw);
    writeSqliteQueryRun(raw, ledgerRun({ paymentMode: "offline", fundingOwner: "offline", settledPayments: 0 }), false);
    const p = ledgerPayment({ settled: false, settlementStatus: "simulated", txHash: null });
    raw.prepare(`INSERT INTO payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,origin)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.id!, p.createdAt, p.kind, p.queryId, p.sourceId, p.sourceName, p.payer, p.payee, p.amountUsdc,
      p.network, 0, "simulated", "web");
    raw.exec("COMMIT");
  } finally { raw.close(); }
  const inspection = await inspectSqliteEnrollment(path, identity);
  await enrollSqliteStorage(path, identity, { format: "keryx-reviewed-storage-enrollment-v1", inspection,
    provenanceDocumentDigest: identity.provenanceDigest, unknownClassAttestation: inspection.unknownClasses });
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: path } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", path);
  vi.stubEnv("KERYX_NETWORK", "arcTestnet"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet"); vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  vi.stubEnv("SUPABASE_URL", ""); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const { createReadonlyEnrolledSqliteAdapter, assertEnrolledSqliteAdapter } = await import("../db/enrolled-sqlite-adapter");
  let reader: Awaited<ReturnType<typeof createReadonlyEnrolledSqliteAdapter>> | undefined;
  try {
    const before = readFileSync(path);
    reader = await createReadonlyEnrolledSqliteAdapter(); expect(assertEnrolledSqliteAdapter(reader, "read")).toEqual(identity);
    const ledger = await readOperatorLedger(reader, identity.network, 7, () => LEDGER_FIXTURE_TIME);
    expect(ledger.payload.jobs[0].funding).toBe("offline"); expect(ledger.payload.jobs[0].legs[0].state).toBe("simulated");
    expect(ledger.payload.trialBalance.debitMicroUsdc).toBe("0"); expect(ledger.payload.entries).toEqual([]);
    expect(readFileSync(path)).toEqual(before); expect(() => reader!.saveQueryRun(ledgerRun())).toThrow("mutation refused");
    writeFileSync(manifest, "{}");
    await expect(readOperatorLedger(reader, identity.network, 7, () => LEDGER_FIXTURE_TIME)).rejects.toThrow();
  } finally { reader?.close(); rmSync(folder, { recursive: true, force: true }); }
}, 30_000);

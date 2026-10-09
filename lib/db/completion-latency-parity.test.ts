import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter, assembleAuthorityBoundSupabaseCore } from "./supabase-adapter";
import { completionFixtureRows, COMPLETION_FIXTURE_NOW } from "../a2a/completion-latency.test-support";
import { summarizeA2aOperations } from "../a2a/operations";
import type { A2aOrder } from "../a2a/order";
import type { StorageDeploymentManifest } from "./runtime-storage-config";
import { STORAGE_TESTNET_PROFILE_DIGEST } from "./storage-identity";
import { SUPABASE_RUNTIME_CONTRACT } from "./supabase-runtime-contract";

vi.mock("@supabase/supabase-js", async original => ({ ...await original<typeof import("@supabase/supabase-js")>(), createClient: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("reads real SQLite markers without exposing private orders or changing their stored bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "keryx-completion-cohorts-")), file = join(root, "synthetic.sqlite");
  const db = new SqliteAdapter(file); await db.init();
  const raw = new DatabaseSync(file);
  try {
    const rows = completionFixtureRows();
    for (const [index, row] of rows.entries()) {
      await db.createA2aOrder({ id: `synthetic_cohort_${index}`, queryId: `synthetic_cohort_${index}`,
        authorizationId: `synthetic_authorization_${index}`, requestHash: "synthetic hash", payer: "PRIVATE_PAYER", payee: "PRIVATE_PAYEE",
        amountUsdc: 0.1, creatorBudgetUsdc: 0.05, serviceFeeUsdc: 0.05, researchMode: "quick",
        researchPackage: row.researchPackage ?? null, status: row.status, transaction: "synthetic no settlement",
        request: { origin: "a2a", question: "PRIVATE_QUESTION" }, startedAt: row.startedAt, workerId: "PRIVATE_WORKER",
        executionJournalVersion: row.executionJournalVersion ?? null, paymentStartedAt: null, resultSavingAt: null,
        response: { answer: "PRIVATE_ANSWER", serviceReceipt: row.serviceReceipt }, errorCode: null,
        resolution: row.resolution ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
      } as A2aOrder);
    }
    const before = raw.prepare("SELECT * FROM a2a_orders ORDER BY id").all();
    const expected = summarizeA2aOperations(rows, COMPLETION_FIXTURE_NOW, true);
    expect(await db.a2aOperationsSnapshot(COMPLETION_FIXTURE_NOW)).toEqual(expected);
    expect((await db.operatorPublicSnapshot(COMPLETION_FIXTURE_NOW)).jobs).toEqual(expected);
    expect(raw.prepare("SELECT * FROM a2a_orders ORDER BY id").all()).toEqual(before);
    expect(JSON.stringify(expected)).not.toMatch(/PRIVATE_|claimId|serviceReceipt|authoritySha256/);
    // Corrupted or scalar historical packets degrade one path to unknown, never the health read.
    raw.prepare("UPDATE a2a_orders SET response_data=?,resolution_data=? WHERE id='synthetic_cohort_0'")
      .run(JSON.stringify({ serviceReceipt: "PRIVATE_SCALAR" }), "not-json");
    const corrupted = await db.a2aOperationsSnapshot(COMPLETION_FIXTURE_NOW);
    expect(corrupted.completionLatencyCohorts?.ordinary.completed).toBe(1);
    expect(corrupted.completionLatencyCohorts?.unknown.completed).toBe(3);
    expect(JSON.stringify(corrupted)).not.toContain("PRIVATE_SCALAR");
  } finally { raw.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

function ordinarySupabase(data: unknown, error: unknown = null) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-no-network.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-live-authority");
  const rpc = vi.fn().mockResolvedValue({ data, error }), from = vi.fn(() => { throw new Error("Capped REST fallback forbidden"); });
  vi.mocked(createClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof createClient>);
  return { db: new SupabaseAdapter(), rpc, from };
}

it("uses one whole-database Supabase RPC for both aggregate projections and keeps old SQL capability unknown", async () => {
  const jobs = summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW, true);
  const whole = { jobs: { ...jobs, queued: 1201 }, creatorCatalog: { registered: 1201 } };
  const { db, rpc, from } = ordinarySupabase(whole);
  expect(await db.a2aOperationsSnapshot(COMPLETION_FIXTURE_NOW)).toEqual(whole.jobs);
  expect(await db.operatorPublicSnapshot(COMPLETION_FIXTURE_NOW)).toEqual(whole);
  expect(rpc.mock.calls).toEqual(Array.from({ length: 2 }, () => ["operator_public_snapshot_v1", { p_now: new Date(COMPLETION_FIXTURE_NOW).toISOString() }]));
  expect(from).not.toHaveBeenCalled();
  const { completionLatencyCohorts: _unavailable, ...legacy } = jobs;
  rpc.mockResolvedValueOnce({ data: { jobs: legacy, creatorCatalog: { registered: 0 } }, error: null });
  expect((await db.a2aOperationsSnapshot(COMPLETION_FIXTURE_NOW)).completionLatencyCohorts).toBeNull();
});

it("propagates SQL refusal without guessing cohorts or falling back to a private REST page", async () => {
  const failure = new Error("Synthetic whole-aggregate refusal"), { db, from } = ordinarySupabase(null, failure);
  await expect(db.a2aOperationsSnapshot(COMPLETION_FIXTURE_NOW)).rejects.toBe(failure);
  expect(from).not.toHaveBeenCalled();
});

it("keeps the sealed markerless RPC explicit without claiming installed provenance or borrowing REST authority", async () => {
  const deployment: StorageDeploymentManifest = { format: "keryx-storage-deployment-v1",
    backend: { kind: "supabase", url: "https://synthetic-no-network.invalid" }, identity: {
      format: "keryx-storage-identity-v1", network: "eip155:5042002", authorityMode: "testnet-offline",
      deploymentId: "11111111-1111-4111-8111-111111111111", storageId: "22222222-2222-4222-8222-222222222222",
      enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-01-01T00:00:00.000Z",
      profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, provenanceDigest: "0".repeat(64),
    } };
  const rows = completionFixtureRows().map(row => ({ status: row.status, created_at: row.createdAt, updated_at: row.updatedAt, started_at: row.startedAt }));
  const rpc = vi.fn((name: string) => {
    const data = name === "read_storage_identity" ? deployment.identity
      : name === "storage_inspect_runtime_readiness" ? { format: "keryx-enrolled-runtime-readiness-v1", ready: true,
        sourceContractDigest: SUPABASE_RUNTIME_CONTRACT.afterDigest, cacheRows: [], cacheRowCount: 0, cacheWireBytes: 0 }
        : name === "storage_a2a_operations_snapshot" ? rows : null;
    const promise = Promise.resolve({ data, error: null }); return Object.assign(promise, { throwOnError: () => promise });
  });
  const from = vi.fn(() => { throw new Error("Sealed REST fallback forbidden"); });
  // Actual offline domain codec in an internal NONPROVENANCE core, never target enrollment.
  const { adapter } = assembleAuthorityBoundSupabaseCore({ rpc, from } as unknown as ReturnType<typeof createClient>, deployment, () => deployment);
  await adapter.init();
  const result = await adapter.a2aOperationsSnapshot(COMPLETION_FIXTURE_NOW);
  expect(result.completedLast24h).toBe(6); expect(result.completionLatencyCohorts).toBeNull();
  expect(rpc).toHaveBeenCalledWith("storage_a2a_operations_snapshot", expect.objectContaining({ p_since: "2026-10-08T00:00:00.000Z", p_expected_identity: deployment.identity }));
  expect(from).not.toHaveBeenCalled();
  await expect(adapter.operatorPublicSnapshot(COMPLETION_FIXTURE_NOW)).rejects.toThrow();
  expect(rpc.mock.calls.some(([name]) => name === "operator_public_snapshot_v1")).toBe(false);
});

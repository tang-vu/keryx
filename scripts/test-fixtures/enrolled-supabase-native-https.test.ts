import { createServer, request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { assembleAuthorityBoundSupabaseCore } from "../../lib/db/supabase-adapter";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "../../lib/db/storage-identity";
import { SUPABASE_RUNTIME_CONTRACT } from "../../lib/db/supabase-runtime-contract";
import { readOwnedFixtureRequestBody } from "./enrolled-supabase-native-https.mjs";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic listener refused");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

it("real SDK receives a response delayed beyond the completed request-body deadline", async () => {
  const server = createServer(async (request, response) => {
    await readOwnedFixtureRequestBody(request, 100);
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    response.setHeader("Content-Type", "application/json");
    response.end("[]");
  });
  const origin = await listen(server);
  try {
    const client = createClient(origin, "synthetic-no-authority", { auth: { persistSession: false } });
    const result = await client.rpc("synthetic_metrics", {}).throwOnError();
    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  } finally { await close(server); }
});

it("still refuses an incomplete request body at its own deadline", async () => {
  let resolveRefusal!: () => void;
  const refused = new Promise<void>((resolve) => { resolveRefusal = resolve; });
  const server = createServer(async (request, response) => {
    try {
      await readOwnedFixtureRequestBody(request, 100);
      response.end("unexpected");
    } catch { resolveRefusal(); }
  });
  const origin = await listen(server);
  try {
    const request = httpRequest(origin, { method: "POST", headers: { "Content-Length": "2" } });
    const disconnected = new Promise<string | undefined>((resolve) => request.once("error", (error: NodeJS.ErrnoException) => resolve(error.code)));
    request.write("{");
    const [, code] = await Promise.all([refused, disconnected]);
    expect(code).toBe("ECONNRESET");
    request.destroy();
  } finally { await close(server); }
});

it("enrolled metrics completes all guarded scans without overlapping bounded backend work", async () => {
  const identity: StorageIdentity = {
    format: "keryx-storage-identity-v1", network: "eip155:5042002", authorityMode: "testnet-offline",
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: "2026-01-01T00:00:00.000Z", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
    provenanceDigest: "0".repeat(64),
  };
  const operations = ["scan_payment_metrics", "scan_query_metrics", "scan_feedback_metrics", "scan_gap_metrics"];
  const reads: string[] = [];
  let active = 0;
  let overlaps = 0;
  let baselinePhase = true;
  let releaseBaseline: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    await readOwnedFixtureRequestBody(request);
    const operation = request.url?.split("/").at(-1) ?? "";
    if (operations.some(name => operation === `storage_${name}`)) {
      if (active > 0) {
        overlaps++;
        if (overlaps === 3) releaseBaseline?.();
        response.writeHead(503, { "Content-Type": "application/json" }).end('{"code":"57014","message":"Synthetic execution bound"}');
        return;
      }
      active++;
      reads.push(operation);
      if (baselinePhase) await new Promise<void>((resolve) => {
        const deadline = setTimeout(resolve, 1500);
        releaseBaseline = () => { clearTimeout(deadline); resolve(); };
      });
      else await new Promise<void>((resolve) => setTimeout(resolve, 30));
      active--;
    }
    const data = operation === "read_storage_identity" ? identity
      : operation === "storage_inspect_runtime_readiness" ? {
        format: "keryx-enrolled-runtime-readiness-v1", ready: true,
        sourceContractDigest: SUPABASE_RUNTIME_CONTRACT.afterDigest, cacheRows: [], cacheRowCount: 0, cacheWireBytes: 0,
      } : operation === "storage_scan_query_metrics" ? [{ id: "fixture-query", origin: "web" }]
        : operation === "storage_scan_feedback_metrics" ? [{ query_id: "fixture-query", rating: "up" }]
          : operation === "storage_scan_gap_metrics" ? [{ status: "filled" }] : [];
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(data));
  });
  const origin = await listen(server);
  try {
    const client = createClient(origin, "synthetic-no-authority", { auth: { persistSession: false } });
    const baseline = await Promise.allSettled(operations.map(name => client.rpc(`storage_${name}`, {}).throwOnError()));
    expect(baseline.filter(result => result.status === "rejected")).toHaveLength(3);
    expect(overlaps).toBe(3);
    baselinePhase = false;
    reads.length = 0;
    const deployment = { format: "keryx-storage-deployment-v1" as const, identity,
      backend: { kind: "supabase" as const, url: origin } };
    // This transport/core assembly intentionally grants no installed-factory provenance.
    const { adapter } = assembleAuthorityBoundSupabaseCore(client, deployment, () => deployment);
    await adapter.init();
    expect(await adapter.metrics()).toEqual({
      totalPayments: 0, totalVolumeUsdc: 0, totalCreatorPayoutsUsdc: 0, creatorsEarning: 0,
      avgPaymentUsdc: 0, totalQueries: 1, payingQueries: 0, readerToPayerConversion: 0,
      evidenceRunSamples: 0, evidenceClaimSamples: 0, groundedClaimRate: 0, citationPoolWithheldRuns: 0,
      gapIntentOffers: 1, gapIntentFilled: 1, gapIntentPending: 0, gapIntentFillRate: 1,
      feedbackTotal: 1, satisfactionRate: 1, pendingPaymentConfirmations: 0, pendingPaymentVolumeUsdc: 0,
      failedPaymentAttempts: 0, failedPaymentVolumeUsdc: 0, mcpClientQueries: [],
    });
    expect(reads).toEqual(operations.map(name => `storage_${name}`));
    expect(overlaps).toBe(3);
  } finally { await close(server); }
});

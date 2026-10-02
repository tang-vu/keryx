import { createServer, request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assembleAuthorityBoundSupabaseCore } from "../../lib/db/supabase-adapter";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "../../lib/db/storage-identity";
import { SUPABASE_RUNTIME_CONTRACT } from "../../lib/db/supabase-runtime-contract";
import { readOwnedFixtureRequestBody, waitForOwnedSourceAdmissionEntry } from "./enrolled-supabase-native-https.mjs";
import { describeOwnedSupabaseCurlState, launchOwnedSupabaseCurl } from "./enrolled-supabase-native-lifecycle.mjs";

it("launches an executor lasting beyond the CI suite and retains parent cleanup ownership after uncertain creation", () => {
  const postgres = `keryx-enrolled-reference-${randomUUID()}`;
  const owned = new Set<string>();
  let launch: string[] = [];
  const docker = (args: string[]) => {
    launch = args;
    expect(owned.has(`${postgres}-curl`)).toBe(true);
    throw new Error("Synthetic timeout after container creation");
  };
  expect(() => launchOwnedSupabaseCurl(postgres, name => owned.add(name), docker)).toThrow("Synthetic timeout");
  expect(launch.slice(0, 5)).toEqual(["run", "-d", "--name", `${postgres}-curl`, "--network"]);
  expect(launch[5]).toBe(`container:${postgres}`);
  const lifetime = /^sleep ([0-9]+)$/.exec(launch.at(-1)!);
  expect(lifetime).not.toBeNull();
  const workflow = readFileSync(new URL("../../.github/workflows/enrolled-supabase-runtime-postgres.yml", import.meta.url), "utf8");
  const suiteMinutes = /timeout-minutes: ([0-9]+)/.exec(workflow);
  expect(suiteMinutes?.[1]).toBe("20");
  expect(Number(lifetime![1])).toBeGreaterThan(Number(suiteMinutes![1]) * 60);
  expect(Number(lifetime![1])).toBeLessThanOrEqual(1800);
  // The actual outer evaluator consumes this set in its finally removal loop.
  expect([...owned]).toEqual([`${postgres}-curl`]);
});

it("diagnoses executor expiry and OOM using only bounded container state", () => {
  const postgres = `keryx-enrolled-reference-${randomUUID()}`;
  const describe = (oom: boolean, exit: number) => describeOwnedSupabaseCurlState(postgres, (args, input, timeout) => {
    expect(args).toEqual(["inspect", "--format",
      "{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.State.StartedAt}} {{.State.FinishedAt}}", `${postgres}-curl`]);
    expect(input).toBeUndefined();
    expect(timeout).toBe(2000);
    return `false ${exit} ${oom} 2026-10-02T02:16:49.123456789Z 2026-10-02T02:31:49.123456789Z\n`;
  });
  expect(describe(false, 0)).toContain("running=false exitCode=0 oomKilled=false");
  expect(describe(true, 137)).toContain("running=false exitCode=137 oomKilled=true");
  expect(describeOwnedSupabaseCurlState(postgres, () => "synthetic unexpected private diagnostic")).toBe("unavailable");
  expect(describeOwnedSupabaseCurlState(postgres, () => { throw new Error("synthetic private failure"); })).toBe("unavailable");
});

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

it("starts lock probes only after actual HTTP source admission entry, before its response", async () => {
  const operation = "storage_browser_signing_admit_source_original";
  const counts = new Map<string, number>([[operation, 1]]);
  let releaseCatalog!: () => void;
  const catalogHold = new Promise<void>(resolve => { releaseCatalog = resolve; });
  let releaseAdmission!: () => void;
  const admissionHold = new Promise<void>(resolve => { releaseAdmission = resolve; });
  let catalogEntered!: () => void;
  const catalogReady = new Promise<void>(resolve => { catalogEntered = resolve; });
  let responded = false;
  const server = createServer(async (request, response) => {
    await readOwnedFixtureRequestBody(request);
    if (request.url === "/catalog") {
      catalogEntered();
      await catalogHold;
    } else {
      counts.set(operation, 2);
      await admissionHold;
      responded = true;
    }
    response.end("[]");
  });
  const origin = await listen(server);
  let probes = 0;
  let terminal = false;
  const waiting = waitForOwnedSourceAdmissionEntry(counts, 1, performance.now() + 5000, () => terminal)
    .then(() => { probes++; });
  void waiting.catch(() => undefined);
  try {
    const catalog = fetch(`${origin}/catalog`, { method: "POST", signal: AbortSignal.timeout(5000) });
    await catalogReady;
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect(probes).toBe(0);
    releaseCatalog();
    await catalog;
    const admission = fetch(`${origin}/admission`, { method: "POST", signal: AbortSignal.timeout(5000) });
    await waiting;
    expect(probes).toBe(1);
    expect(responded).toBe(false);
    releaseAdmission();
    await admission;
  } finally {
    terminal = true;
    releaseCatalog();
    releaseAdmission();
    await Promise.allSettled([waiting]);
    await close(server);
  }
});

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
      evidenceRunSamples: 0, evidenceClaimSamples: 0, groundedClaimRate: null,
      evidenceQuality: { status: "unavailable", basis: "recorded-unreassessed",
        explanation: "Stored historical evidence counters have not been reassessed against current source provenance; aggregate factual grounding is unavailable." },
      citationPoolWithheldRuns: 0,
      gapIntentOffers: 1, gapIntentFilled: 1, gapIntentPending: 0, gapIntentFillRate: 1,
      feedbackTotal: 1, satisfactionRate: 1, pendingPaymentConfirmations: 0, pendingPaymentVolumeUsdc: 0,
      failedPaymentAttempts: 0, failedPaymentVolumeUsdc: 0, mcpClientQueries: [],
    });
    expect(reads).toEqual(operations.map(name => `storage_${name}`));
    expect(overlaps).toBe(3);
  } finally { await close(server); }
});

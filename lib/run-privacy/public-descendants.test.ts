// @vitest-environment jsdom
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { act, createElement, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, WagmiProvider } from "wagmi";
import { custom } from "viem";
import { NextRequest } from "next/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { requirePrivacy, type PrivacyActor, type RunVisibility } from "./contracts";
import { usageWindow } from "../usage/contracts";
import { createTrustedUsageContext, newRunUsage } from "../research/usage-provenance";
import type { QueryRun } from "../types";

// Synthetic acquisition/auth only. All storage predicates, source/demand readers,
// projections, route exports, UI components and renderer implementations are real.
const boundary = vi.hoisted(() => {
  vi.stubEnv("BASE_URL", "https://descendants.invalid");
  vi.stubEnv("KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  return { db: vi.fn(), session: vi.fn(), account: vi.fn(), key: vi.fn() };
});
vi.mock("@/lib/db", () => ({ getDb: boundary.db }));
vi.mock("@/lib/auth", () => ({ getSession: boundary.session }));
vi.mock("@/lib/account-sessions", () => ({ accountSessionContext: boundary.account }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: boundary.key }));
vi.mock("@/lib/config", async () => {
  const { ARC_TESTNET_PROFILE } = await import("../arc-network-profile");
  return { config: { baseUrl: "https://descendants.invalid", networkId: ARC_TESTNET_PROFILE.networkId,
    profile: ARC_TESTNET_PROFILE } };
});

import { arcTestnet } from "../chains";
import { getTestnetArchive, type TestnetArchiveStore } from "../history/testnet-archive";
import { demandGapId } from "../demand-signal";
import { EARNINGS_COLUMNS, type EarningsExportRow } from "../creator/earnings-export";
import { PORTFOLIO_COLUMNS, type PortfolioExportRow } from "../creator/portfolio-export";
import { toCsv } from "../creator/csv";
import { GET as sourceExport } from "@/app/api/creator/[id]/export/route";
import { GET as portfolioExport } from "@/app/api/creator/export/route";
import { GET as dispatch } from "@/app/api/dispatch/[id]/route";
import { PATCH as ownerChange, DELETE as ownerErase } from "@/app/api/me/run-privacy/[id]/route";
import { GET as ownerExport } from "@/app/api/me/run-privacy/[id]/export/route";
import { GET as runs } from "@/app/api/runs/route";
import { GET as payments } from "@/app/api/payments/route";
import { GET as metrics } from "@/app/api/metrics/route";
import { GET as withdrawals } from "@/app/api/withdrawals/route";
import SourcesPage, { metadata as sourcesMetadata } from "@/app/sources/page";
import WantedPage from "@/app/wanted/page";
import WantedClaimPage, { generateMetadata as wantedMetadata } from "@/app/wanted/[id]/page";
import WantedClaimOgImage from "@/app/wanted/[id]/opengraph-image";
import HistoryPage, { metadata as historyMetadata } from "@/app/history/testnet/page";
import DashboardPage from "@/app/dashboard/page";
import { DashboardView } from "@/components/keryx/dashboard-view";
import { HistoricalHistorySection } from "@/components/keryx/testnet-history-summary";

const origin = "https://descendants.invalid", network = "eip155:5042002" as const;
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const sessionHash = createHash("sha256").update("synthetic-descendants-alice").digest("hex");
const actor: PrivacyActor = { wallet: alice, sessionHash, binding: { network, origin } };
const targetId = "descendants-target", controlId = "descendants-control";
const sourceId = "descendants-source", inactiveSourceId = "descendants-inactive";
const secret = "DESCENDANT266", custody = "SYNTHETIC-CUSTODY266";
const question = `${secret} confidential question`, claim = `${secret} spectral astronomy measurement`;
const documentUrl = `https://publication.invalid/${secret}`;
const gapId = demandGapId(claim), controlClaim = "Metallic conductivity reference measurement";
const controlGapId = demandGapId(controlClaim);
const levels = ["private", "unlisted", "public"] as const;
const viewers = [undefined, bob, alice] as const;
let db: SqliteAdapter, connection: DatabaseSync, original: QueryRun;
let queryClient: QueryClient, walletConfig: ReturnType<typeof createConfig>;
let root: Root | undefined, container: HTMLDivElement | undefined;
const archives: TestnetArchiveStore[] = [], directories: string[] = [];
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`${origin}${path}`, init);
const setViewer = (wallet?: string) => boundary.session.mockResolvedValue(wallet ? { address: wallet } : null);
const forbidden = () => { throw new Error("Synthetic descendants fixture forbids external execution"); };
// Real host contexts for real components, with no connectors or RPC access.
// Navigation/prefetch cannot load a route; the test never clicks or signs.
const router: AppRouterInstance = { back: forbidden, forward: forbidden, refresh: forbidden,
  push: forbidden, replace: forbidden, prefetch: () => {}, bfcacheId: "synthetic-descendants" };
function host(children: ReactNode) {
  return createElement(PathnameContext.Provider, { value: "/dashboard", children:
    createElement(AppRouterContext.Provider, { value: router, children:
      createElement(WagmiProvider, { config: walletConfig, reconnectOnMount: false, children:
        createElement(QueryClientProvider, { client: queryClient, children }) }) }) });
}
const html = (node: ReactNode) => renderToStaticMarkup(host(node));
// Inspect *all* serializable props as well as rendered HTML; React module metadata
// is not payload (Next Link's type has a circular default). No data key is dropped.
const payload = (value: unknown) => JSON.stringify(value, (_key, item: unknown) =>
  isValidElement<Record<string, unknown>>(item)
    ? { type: typeof item.type === "string" ? item.type : undefined, key: item.key, props: item.props }
    : item);
function descendants(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [{ type: node.type, props: node.props }, ...descendants(node.props.children as ReactNode)];
}
async function packet(response: Response) {
  return { status: response.status, headers: [...response.headers], body: await response.text() };
}
async function missingBrief(id: string) {
  try { await WantedClaimPage(params(id)); throw new Error("Expected actual Next notFound"); }
  catch (error) {
    const value = error as Error & { digest?: string };
    expect(value.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    return { message: value.message, digest: value.digest };
  }
}
function save(id: string, text: string, time: string, coverageClaim: string, citedDocument = false) {
  const run: QueryRun = { id, asker: alice, createdAt: time, origin: "web", question: text,
    answer: `Synthetic answer ${text}`, budget: 0.030001, engine: "heuristic",
    totalSpent: id === targetId ? 0.012345 : 0.000007, totalToCreators: id === targetId ? 0.000001 : 0.000007,
    subClaims: [coverageClaim], decisions: [], trace: [],
    claimCoverage: [{ claimIndex: 0, claim: coverageClaim, coverage: 0.1, coveredBy: [] }],
    citations: [{ marker: "S1", sourceId, sourceName: "Synthetic creator", weight: 1,
      reward: 0.000001, rationale: "Synthetic recorded citation" },
      ...(citedDocument ? [{ marker: "S2", sourceId: "synthetic-reference", sourceName: `${secret} publisher`,
        sourceKind: "public-reference" as const, itemTitle: `${secret} document title`, itemUrl: documentUrl,
        publicDeliveryKind: "metadata_only" as const, weight: 0, reward: 0, rationale: "Synthetic citation metadata" }] : [])],
    usage: newRunUsage({ usageContext: createTrustedUsageContext(network,
      { actor: "unknown", funding: "unknown", scripted: false }) }, network, []),
  };
  // Fixture rows deliberately exercise the ordinary metadata selector; they are
  // entirely synthetic, not real outside traffic, paid content or settlement.
  writeSqliteQueryRun(connection, run, false);
  return JSON.parse(String(connection.prepare("SELECT data FROM query_runs WHERE id=?").get(id)!.data)) as QueryRun;
}
async function setVisibility(visibility: RunVisibility, id = targetId) {
  const state = (await requirePrivacy(db).owner(id, actor))!.state;
  return requirePrivacy(db).change(id, actor, { visibility, revision: state.revision, requestId: randomUUID() });
}
async function mutate(visibility?: RunVisibility) {
  const state = (await requirePrivacy(db).owner(targetId, actor))!.state;
  const requestId = randomUUID(), erase = visibility === undefined;
  const response = await (erase ? ownerErase : ownerChange)(request(`/api/me/run-privacy/${targetId}`, {
    method: erase ? "DELETE" : "PATCH", headers: { Origin: origin, "X-Keryx-Expected-Wallet": alice,
      "Content-Type": "application/json" }, body: JSON.stringify({ revision: state.revision, requestId,
        ...(visibility ? { visibility } : {}) }),
  }), params(targetId));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ visibility: visibility ?? "private", revision: state.revision + 1, erased: erase });
  expect(connection.prepare("SELECT action,wallet,run_id FROM run_privacy_audit WHERE request_id=?").get(requestId))
    .toMatchObject({ action: erase ? "erase" : "visibility", wallet: alice, run_id: targetId });
}
async function finances() {
  return { journals: connection.prepare("SELECT * FROM payment_events ORDER BY id").all(),
    counters: connection.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs ORDER BY id").all(),
    rewards: connection.prepare("SELECT id,status,attempts,retry_run_id,coverage,reward_usdc FROM gap_intents ORDER BY id").all(),
    creators: await db.creatorLeaderboard(), daily: await db.dailySettled(14),
    summary: await db.publicUsage!.summary(usageWindow(new URLSearchParams("period=all"), network,
      new Date("2026-11-01T00:00:00.000Z"))), publicPayments: await (await payments(request("/api/payments"))).json() };
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("BASE_URL", origin);
  vi.stubEnv("KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "");
  vi.stubEnv("KERYX_TESTNET_ARCHIVE_MANIFEST", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal("fetch", vi.fn(forbidden));
  db = new SqliteAdapter(":memory:"); await db.init();
  connection = (db as unknown as { db: DatabaseSync }).db;
  connection.exec(RUN_PRIVACY_SQL); await db.init();
  expect(db.runPrivacyActive).toBe(true); requirePrivacy(db);
  await db.createWebSession({ hash: sessionHash, wallet: alice, issuedAt: Date.now() - 1000, expiresAt: Date.now() + 120_000 });
  for (const id of [sourceId, inactiveSourceId]) await db.upsertSource({ id, name: `Synthetic ${id}`,
    walletAddress: bob, authors: [], url: `${origin}/${id}`, description: "Synthetic in-memory fixture only",
    fetchPrice: 0, tags: [], createdAt: "2026-10-11T00:00:00.000Z", active: id === sourceId });
  save(controlId, "Published comparison question", "2026-10-11T00:00:00.000Z", controlClaim);
  await setVisibility("public", controlId);
  original = save(targetId, question, "2026-10-11T01:00:00.000Z", claim, true);
  // Exact micro-USDC rows are synthetic recorded states, never provider/chain proof.
  for (const [index, status] of (["settled", "pending", "failed", "simulated"] as const).entries()) {
    await db.recordPayment({ id: `descendant-${status}`, queryId: targetId, kind: "citation", sourceId,
      sourceName: `Synthetic ${sourceId}`, payer: alice, payee: bob, amountUsdc: (index + 1) / 1_000_000,
      network, settled: status === "settled", settlementStatus: status, weight: 1,
      txHash: status === "settled" ? "synthetic-descendant-settlement" : null,
      rationale: `${secret} synthetic journal rationale`, authorizationId: `${custody}-nonce`, grantEpoch: `${custody}-epoch`,
      createdAt: `2026-10-11T01:00:0${index}.000Z` });
  }
  await db.recordPayment({ id: "descendant-control", queryId: controlId, kind: "fetch", sourceId: inactiveSourceId,
    sourceName: `Synthetic ${inactiveSourceId}`, payer: alice, payee: bob, amountUsdc: 0.000007, network,
    settled: true, settlementStatus: "settled", txHash: "synthetic-control-settlement", createdAt: "2026-10-11T00:00:00.000Z" });
  // Terminal offers permit erasure. A public control's retry link must itself be
  // PUBLIC, even when the failed parent is public. No worker or provider is run.
  const insert = connection.prepare(`INSERT INTO gap_intents
    (id,gap_id,claim,question,failed_query_id,source_id,source_item_link,owner_wallet,status,attempts,retry_run_id,coverage,reward_usdc,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'failed',1,?,0.1,0.000001,?,?)`);
  insert.run("descendant-offer", gapId, claim, question, targetId, sourceId, `${origin}/${secret}-offer`, bob,
    null, original.createdAt, original.createdAt);
  insert.run("descendant-retry", controlGapId, controlClaim, "Published comparison question", controlId, sourceId,
    `${origin}/comparison-offer`, bob, targetId, original.createdAt, original.createdAt);
  boundary.db.mockResolvedValue(db); setViewer(); boundary.key.mockResolvedValue(null);
  boundary.account.mockResolvedValue({ db, wallet: alice, currentId: sessionHash });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  walletConfig = createConfig({ chains: [arcTestnet], connectors: [], storage: null, ssr: true,
    multiInjectedProviderDiscovery: false, transports: { [arcTestnet.id]: custom({ request: async () => forbidden() }) } });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; container?.remove(); container = undefined;
  for (const archive of archives.splice(0)) archive.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  queryClient?.clear(); db?.close(); vi.clearAllTimers(); vi.useRealTimers();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

async function statement(visibility: RunVisibility | "erased") {
  const response = await portfolioExport(request("/api/creator/export?format=json"));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store, private");
  const result = await response.json();
  expect(result.sources.map((source: { id: string }) => source.id).sort()).toEqual([inactiveSourceId, sourceId].sort());
  expect(result.sources.find((source: { id: string }) => source.id === inactiveSourceId).active).toBe(false);
  expect(result.summary).toMatchObject({ paymentCount: 5, citationCount: 4, fetchCount: 1, totalUsdc: 0.000017, settledUsdc: 0.000008 });
  const rows = result.payments as PortfolioExportRow[];
  expect(rows.map(row => [row.source_id, row.amount_usdc, row.settlement_status, row.settlement_ref])).toEqual([
    [sourceId, "0.000004", "simulated", ""], [sourceId, "0.000003", "failed", ""],
    [sourceId, "0.000002", "pending", ""], [sourceId, "0.000001", "settled", "synthetic-descendant-settlement"],
    [inactiveSourceId, "0.000007", "settled", "synthetic-control-settlement"],
  ]);
  expect(Object.keys(rows[0])).toEqual(PORTFOLIO_COLUMNS);
  for (const row of rows) {
    expect(row.question).toBe(row.dispatch_id === controlId ? "Published comparison question" : visibility === "public" ? question : "");
    // Immutable payout IDs/links remain public financial evidence; only question
    // enrichment is removed. The linked private payload is checked below.
    expect(row.dispatch_url).toBe(`${origin}/dispatch/${row.dispatch_id}`);
    expect(row.authorization_id).toBe("");
  }
  expect(payload(result)).not.toContain(custody);
  const csv = await portfolioExport(request("/api/creator/export?format=csv"));
  expect(csv.status).toBe(200); expect(csv.headers.get("cache-control")).toBe("no-store, private");
  expect(await csv.text()).toBe(toCsv(PORTFOLIO_COLUMNS, rows));
  // Per-source CSV invokes its own route/reader/projection; no test registration import.
  const one = await sourceExport(request(`/api/creator/${sourceId}/export?format=json`), params(sourceId));
  expect(one.status).toBe(200); const perSource = await one.json();
  expect(perSource.summary).toMatchObject({ paymentCount: 4, citationCount: 4, fetchCount: 0, totalUsdc: 0.000010, settledUsdc: 0.000001 });
  expect(Object.keys(perSource.payments[0])).toEqual(EARNINGS_COLUMNS);
  expect(perSource.payments).toEqual(rows.filter(row => row.source_id === sourceId).map(({ source_id: _id, source_name: _name, ...row }) => row));
  const download = await sourceExport(request(`/api/creator/${sourceId}/export?format=csv`), params(sourceId));
  expect(download.status).toBe(200); expect(download.headers.get("cache-control")).toBe("no-store");
  expect(await download.text()).toBe(toCsv(EARNINGS_COLUMNS, perSource.payments as EarningsExportRow[]));
  return { summary: result.summary, bySource: result.bySource,
    payments: rows.map(({ question: _question, ...row }) => row), perSourceSummary: perSource.summary };
}

describe("#266 existing creator export descendants", () => {
  it.each(levels)("%s earnings access never grants run ownership; CSV/JSON and scoped keys keep exact payouts", async visibility => {
    await setVisibility(visibility); const before = await finances();
    setViewer(bob); const creatorStatement = await statement(visibility);
    const publicCsv = await packet(await sourceExport(request(`/api/creator/${sourceId}/export?format=csv`), params(sourceId)));
    if (visibility === "private") {
      const denied = await packet(await dispatch(request(`/api/dispatch/${targetId}`), params(targetId)));
      const unknown = await packet(await dispatch(request("/api/dispatch/unknown"), params("unknown")));
      expect(denied).toEqual(unknown); expect(denied.status).toBe(404);
      expect(denied.body).not.toMatch(/DESCENDANT266|SYNTHETIC-CUSTODY266|descendants-target/);
    }
    setViewer(alice); // Research owner cannot name someone else's portfolio into their export.
    expect(await packet(await sourceExport(request(`/api/creator/${sourceId}/export?format=csv`), params(sourceId)))).toEqual(publicCsv);
    const foreign = await portfolioExport(request(`/api/creator/export?format=json&wallet=${bob}`));
    expect(foreign.status).toBe(404); expect(await foreign.json()).toEqual({ error: "no sources owned by this wallet", wallet: alice });
    setViewer(); const anonymous = await portfolioExport(request("/api/creator/export?format=json"));
    expect(anonymous.status).toBe(401); expect(await anonymous.text()).not.toContain(secret);
    expect(await packet(await sourceExport(request(`/api/creator/${sourceId}/export?format=csv`), params(sourceId)))).toEqual(publicCsv);
    if (visibility === "private") expect(await packet(await dispatch(request(`/api/dispatch/${targetId}`), params(targetId))))
      .toEqual(await packet(await dispatch(request("/api/dispatch/unknown"), params("unknown"))));
    // A source pin intersects actual ownership; history:read does not enrich private research.
    boundary.key.mockResolvedValue({ keyId: "synthetic-export-key", walletAddress: bob, scopes: "export,history:read",
      sourceIds: `${sourceId},${inactiveSourceId},not-owned` });
    const keyed = await portfolioExport(request("/api/creator/export?format=json", { headers: { Authorization: "Bearer synthetic-export-key" } }));
    expect(keyed.status).toBe(200); const keyedBody = await keyed.json();
    expect(keyedBody.summary).toEqual(creatorStatement.summary); expect(keyedBody.bySource).toEqual(creatorStatement.bySource);
    expect(keyedBody.sources.map((row: { id: string }) => row.id)).not.toContain("not-owned");
    expect(keyedBody.payments.map((row: PortfolioExportRow) => row.question)).toEqual([
      ...Array<string>(4).fill(visibility === "public" ? question : ""), "Published comparison question",
    ]);
    expect(payload(keyedBody)).not.toContain(custody); expect(await finances()).toEqual(before);
  });

  it.each(["revoked", "insufficient-scope"] as const)("%s Bearer export refuses a valid creator cookie without reading payout rows", async kind => {
    setViewer(bob);
    boundary.key.mockResolvedValue(kind === "revoked" ? null : { keyId: "synthetic-refused-key", walletAddress: bob, scopes: "history:read", sourceIds: null });
    const journal = vi.spyOn(db, "listPaymentsBySource"); // Call observation only; real implementation retained.
    const response = await portfolioExport(request("/api/creator/export?format=csv", { headers: { Authorization: "Bearer synthetic-refused-key" } }));
    expect(response.status).toBe(kind === "revoked" ? 401 : 403);
    expect(await response.text()).not.toMatch(/DESCENDANT266|SYNTHETIC-CUSTODY266|descendants-source/);
    expect(journal).not.toHaveBeenCalled(); expect(boundary.session).not.toHaveBeenCalled();
  });

  it("a pinned key loses a source when live creator ownership changes, without changing the retained payout journal", async () => {
    const before = await finances();
    boundary.key.mockResolvedValue({ keyId: "synthetic-pinned-key", walletAddress: bob, scopes: "export", sourceIds: sourceId });
    const keyRequest = () => request("/api/creator/export?format=json", { headers: { Authorization: "Bearer synthetic-pinned-key" } });
    const first = await portfolioExport(keyRequest()); expect(first.status).toBe(200);
    expect((await first.json()).payments).toHaveLength(4);
    const source = (await db.getSource(sourceId))!;
    await db.upsertSource({ ...source, walletAddress: alice }); // Synthetic source row, no registry/provider authority.
    const lost = await portfolioExport(keyRequest()); expect(lost.status).toBe(404);
    expect(await lost.json()).toEqual({ error: "no sources owned by this wallet", wallet: bob });
    expect(await finances()).toEqual(before);
  });

  it("owner visibility/export/erase changes remove statement text while retaining exact journals, rewards and public settlement totals", async () => {
    const before = await finances(); setViewer(bob); const initial = await statement("private");
    for (const visibility of ["public", "unlisted", "private", "public"] as const) {
      await mutate(visibility); setViewer(bob);
      expect(await statement(visibility)).toEqual(initial); expect(await finances()).toEqual(before);
    }
    setViewer(alice); const requestId = randomUUID();
    const exported = await ownerExport(request(`/api/me/run-privacy/${targetId}/export`, { headers: { "X-Keryx-Request-Id": requestId } }), params(targetId));
    expect(exported.status).toBe(200); expect((await exported.json()).run).toEqual(original);
    expect(connection.prepare("SELECT action,original_digest FROM run_privacy_audit WHERE request_id=?").get(requestId))
      .toMatchObject({ action: "export", original_digest: createHash("sha256").update(String(connection.prepare("SELECT data FROM query_runs WHERE id=?").get(targetId)!.data)).digest("hex") });
    await mutate(); setViewer(bob);
    expect(await statement("erased")).toEqual(initial); expect(await finances()).toEqual(before);
    expect(payload(connection.prepare("SELECT data,question,answer FROM query_runs WHERE id=?").get(targetId))).not.toContain(secret);
    expect(await packet(await dispatch(request(`/api/dispatch/${targetId}`), params(targetId))))
      .toEqual(await packet(await dispatch(request("/api/dispatch/unknown"), params("unknown"))));
  });
});

async function sourceAndWanted() {
  const wanted = await WantedPage(), sources = await SourcesPage({ searchParams: Promise.resolve({ kind: "cited" }) });
  const control = await WantedClaimPage(params(controlGapId));
  return { wanted: { html: html(wanted), payload: payload(wanted) }, sources: { html: html(sources), payload: payload(sources) },
    control: { html: html(control), payload: payload(control) } };
}
function expectDiscovery(value: Awaited<ReturnType<typeof sourceAndWanted>>, published: boolean) {
  for (const text of [value.wanted.html, value.wanted.payload, value.sources.html, value.sources.payload])
    expect(text.includes(secret)).toBe(published);
  expect(value.wanted.html.includes(`/dispatch/${targetId}`)).toBe(published);
  expect(value.wanted.html.includes(`/wanted/${gapId}`)).toBe(published);
  expect(value.sources.html.includes(documentUrl)).toBe(published);
  expect(value.sources.html.includes(`/dispatch/${targetId}`)).toBe(published);
  expect(value.control.html.includes(`/dispatch/${targetId}`)).toBe(published); // Public failed parent, hidden retry descendant.
  expect(value.wanted.html).toContain(controlClaim); expect(value.control.html).toContain(controlClaim);
  expect(payload(value)).not.toContain(custody);
}
describe("#266 real wanted/source renderer descendants", () => {
  it.each(levels)("%s cannot leak through wanted brief metadata, retry links, source-card titles or props for any viewer", async visibility => {
    await setVisibility(visibility); const before = await finances();
    for (const viewer of viewers) {
      setViewer(viewer); expectDiscovery(await sourceAndWanted(), visibility === "public");
      if (visibility === "public") {
        const page = await WantedClaimPage(params(gapId));
        expect(html(page)).toContain(claim); expect(payload(page)).toContain(claim);
        expect(html(page)).toContain(`/dispatch/${targetId}`);
        expect(payload(await wantedMetadata(params(gapId)))).toContain(claim);
      } else {
        expect(await missingBrief(gapId)).toEqual(await missingBrief("0".repeat(64)));
        expect(await wantedMetadata(params(gapId))).toEqual(await wantedMetadata(params("0".repeat(64))));
      }
      expect(payload(sourcesMetadata)).not.toContain(secret); expect(await finances()).toEqual(before);
    }
  });

  it("previously public wanted/source renderers reselect on unlisting, private change and owner erasure", async () => {
    const before = await finances();
    for (const visibility of ["public", "unlisted", "private", "public"] as const) {
      await mutate(visibility); expectDiscovery(await sourceAndWanted(), visibility === "public");
      if (visibility !== "public") expect(await wantedMetadata(params(gapId))).toEqual(await wantedMetadata(params("0".repeat(64))));
    }
    await mutate(); expectDiscovery(await sourceAndWanted(), false);
    expect(await missingBrief(gapId)).toEqual(await missingBrief("0".repeat(64)));
    expect(await finances()).toEqual(before);
  });

  it("unadmitted current storage refuses descendant exports/briefs and renders unavailable citations without raw text fallback", async () => {
    const before = await finances(); await setVisibility("public");
    expectDiscovery(await sourceAndWanted(), true);
    connection.exec("DROP TRIGGER run_privacy_new"); // Drift only on the owned :memory: fixture.
    setViewer(bob);
    for (const format of ["csv", "json"]) {
      for (const response of [await portfolioExport(request(`/api/creator/export?format=${format}`)),
        await sourceExport(request(`/api/creator/${sourceId}/export?format=${format}`), params(sourceId))]) {
        expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "privacy_unavailable" });
      }
    }
    const wanted = await WantedPage(), sources = await SourcesPage({ searchParams: Promise.resolve({ kind: "cited" }) });
    expect(html(wanted)).not.toContain(secret); expect(payload(wanted)).not.toContain(secret);
    expect(html(sources)).not.toContain(secret); expect(payload(sources)).not.toContain(secret);
    expect(html(sources)).toContain("role=\"status\"");
    await expect(WantedClaimPage(params(gapId))).rejects.toThrow("privacy_unavailable");
    expect(await wantedMetadata(params(gapId))).toEqual(await wantedMetadata(params("0".repeat(64))));
    expect(connection.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(before.journals);
    expect(connection.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs ORDER BY id").all()).toEqual(before.counters);
    expect(await db.creatorLeaderboard()).toEqual(before.creators);
  });

  it("actual wanted OG bytes match absent/private/unlisted/revoked/erased/unavailable briefs and differ only when public", async () => {
    // jsdom replaces Uint8Array; Node's TextEncoder still produces native bytes.
    // Align Sharp's constructor check only for this real renderer case.
    vi.stubGlobal("Uint8Array", new TextEncoder().encode().constructor);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const value = input instanceof Request ? input.url : String(input);
      if (value.startsWith("data:application/octet-stream;base64,"))
        return new Response(Buffer.from(value.split(",")[1], "base64"), { headers: { "Content-Type": "application/wasm" } });
      const url = new URL(value); if (url.protocol !== "file:") return forbidden();
      return new Response(await readFile(fileURLToPath(url)), { headers: { "Content-Type": "application/wasm" } });
    }));
    const image = async (id = gapId) => {
      const response = await WantedClaimOgImage(params(id));
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      return createHash("sha256").update(body).digest("hex");
    };
    const absent = await image("0".repeat(64)); expect(await image()).toBe(absent);
    await mutate("unlisted"); expect(await image()).toBe(absent);
    await mutate("public"); expect(await image()).not.toBe(absent);
    await mutate("private"); expect(await image()).toBe(absent);
    await mutate(); expect(await image()).toBe(absent);
    connection.exec("DROP TRIGGER run_privacy_new"); expect(await image()).toBe(absent);
  }, 30_000);
});

// Reuse the existing source schema installer and real immutable archive loader.
// The disk snapshot is synthetic test input, never a retained production original.
async function frozenArchive() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-descendants266-")); directories.push(directory);
  const database = join(directory, "history.sqlite"), manifest = join(directory, "manifest.json");
  const writer = new DatabaseSync(database);
  try {
    installSqliteApplicationSchema(writer);
    for (const row of connection.prepare("SELECT data FROM query_runs ORDER BY id").all())
      writeSqliteQueryRun(writer, JSON.parse(String(row.data)) as QueryRun, false);
    const rows = connection.prepare("SELECT * FROM payment_events ORDER BY id").all();
    const columns = Object.keys(rows[0]);
    const insert = writer.prepare(`INSERT INTO payment_events (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
    for (const row of rows) insert.run(...columns.map(column => row[column] as SQLInputValue));
  } finally { writer.close(); }
  const bytes = readFileSync(database), hash = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(manifest, JSON.stringify({ version: 1, network, capturedAt: "2026-10-12T00:00:00.000Z",
    sourceCommit: "14ae99f04c59af449e0ee6d4b6d180c37e551b5c", database, databaseSha256: hash }));
  vi.stubEnv("KERYX_TESTNET_ARCHIVE_MANIFEST", manifest);
  const archive = (await getTestnetArchive())!; expect(archive).not.toBeNull(); archives.push(archive);
  return { archive, database, bytes };
}
describe("#266 complete historical page and dashboard history descendants", () => {
  it.each(levels)("%s current authority never publishes frozen historical questions in the real page; totals/original bytes stay intact", async visibility => {
    await setVisibility(visibility); const f = await frozenArchive();
    const summary = await f.archive.summary(), creators = await f.archive.creatorLeaderboard();
    expect(summary).toMatchObject({ totalQueryRuns: 2, settledCreatorMicroUsdc: 8, settledCreatorPaymentCount: 2,
      payments: { settled: { count: 2, amountMicroUsdc: 8 }, pending: { count: 1, amountMicroUsdc: 2 },
        failed: { count: 1, amountMicroUsdc: 3 }, simulated: { count: 1, amountMicroUsdc: 4 } } });
    // A controlled inactive baseline demonstrates this actual archive contains
    // text; restoring the flag invokes its real guard, not a fake empty archive.
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "");
    expect((await f.archive.listRecentQueries(51)).map(run => run.id)).toEqual([targetId, controlId]);
    const inactivePage = await HistoryPage({ searchParams: Promise.resolve({}) });
    expect(html(inactivePage)).toContain(question); expect(payload(inactivePage)).toContain(question);
    expect(html(inactivePage)).toContain(`/dispatch/${targetId}`);
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
    for (const viewer of viewers) {
      setViewer(viewer);
      const page = await HistoryPage({ searchParams: Promise.resolve({}) });
      expect(html(page)).not.toContain(secret); expect(payload(page)).not.toContain(secret);
      expect(html(page)).not.toContain(`/dispatch/${targetId}`); expect(payload(historyMetadata)).not.toContain(secret);
      expect(html(page)).toContain("testnet-history"); expect(html(page)).toContain("test USDC");
      const historical = await HistoricalHistorySection();
      expect(html(historical)).not.toContain(secret); expect(html(historical)).not.toContain(`/dispatch/${targetId}`);
      expect(await f.archive.summary()).toEqual(summary); expect(await f.archive.creatorLeaderboard()).toEqual(creators);
    }
    await mutate();
    expect(html(await HistoryPage({ searchParams: Promise.resolve({}) }))).not.toContain(secret);
    expect(await f.archive.getQueryRun(targetId)).toEqual(original); // Frozen direct recovery is a distinct unlisted authority.
    expect(await f.archive.summary()).toEqual(summary); expect(await f.archive.creatorLeaderboard()).toEqual(creators);
    expect(readFileSync(f.database)).toEqual(f.bytes);
  });

  it("missing configured archive produces real page/dashboard unavailable states without exposing current run bodies", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-descendants266-missing-")); directories.push(directory);
    vi.stubEnv("KERYX_TESTNET_ARCHIVE_MANIFEST", join(directory, "missing-manifest.json"));
    const page = await HistoryPage({ searchParams: Promise.resolve({}) }), section = await HistoricalHistorySection();
    for (const node of [page, section]) {
      expect(html(node)).toContain("role=\"status\""); expect(html(node)).not.toContain(secret);
      expect(payload(node)).not.toContain(`/dispatch/${targetId}`);
    }
  });
});

async function dashboardNode() {
  const page = DashboardPage(); expect(page.type).toBe(DashboardView);
  // Materialize the exact two async server children selected by DashboardPage,
  // retaining their real implementations/props. No replacement UI or hook data.
  const previews: Record<string, ReactNode> = {};
  for (const name of ["sourcePreview", "historyPreview"] as const) {
    const server = descendants(page.props[name]).find(element => typeof element.type === "function");
    expect(server).toBeDefined();
    previews[name] = await (server!.type as (props: Record<string, unknown>) => Promise<ReactNode>)(server!.props);
  }
  return createElement(DashboardView, { sourcePreview: previews.sourcePreview, historyPreview: previews.historyPreview });
}
function ledgerTransport() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: ConstructorParameters<typeof NextRequest>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin) return forbidden();
    const req = request(`${url.pathname}${url.search}`, init);
    switch (url.pathname) {
      case "/api/runs": return runs(req);
      case "/api/payments": return payments(req);
      case "/api/metrics": return metrics();
      case "/api/withdrawals": return withdrawals(req);
      case "/api/auth/session": return Response.json({ session: null }); // Synthetic disconnected shell auth only.
      default: return forbidden();
    }
  }));
}
async function mountDashboard() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ledgerTransport(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const node = await dashboardNode(); await act(async () => { root!.render(host(node)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}
it("real dashboard polling and source preview remove public text/hrefs after owner changes and deletion for foreign/owner/anonymous readers", async () => {
  const before = await finances(); await mutate("public"); setViewer(bob); await mountDashboard();
  expect(container!.textContent).toContain(question); expect(container!.querySelector(`a[href='/dispatch/${targetId}']`)).not.toBeNull();
  expect(container!.innerHTML).toContain(documentUrl);
  for (const [visibility, viewer] of [["unlisted", alice], ["private", bob], ["public", undefined]] as const) {
    await mutate(visibility); setViewer(viewer);
    // Existing sourcePreview is an SSR observation; refresh the real server
    // children as a new page request would, while the current history hook polls.
    await act(async () => { root!.render(host(await dashboardNode())); await vi.advanceTimersByTimeAsync(10_000); });
    expect(container!.textContent!.includes(question)).toBe(visibility === "public");
    expect(container!.innerHTML.includes(documentUrl)).toBe(visibility === "public");
    expect(!!container!.querySelector(`a[href='/dispatch/${targetId}']`)).toBe(visibility === "public");
    expect(container!.textContent).toContain("Published comparison question"); expect(await finances()).toEqual(before);
  }
  await mutate();
  await act(async () => { root!.render(host(await dashboardNode())); await vi.advanceTimersByTimeAsync(10_000); });
  expect(container!.textContent).not.toContain(secret); expect(container!.innerHTML).not.toContain(documentUrl);
  expect(container!.querySelector(`a[href='/dispatch/${targetId}']`)).toBeNull(); expect(await finances()).toEqual(before);
});
it("a fresh dashboard with unavailable privacy storage shows an honest question-read failure without hidden text or href fallback", async () => {
  connection.exec("DROP TRIGGER run_privacy_new"); await mountDashboard();
  expect(container!.textContent).not.toContain(secret); expect(container!.innerHTML).not.toContain(documentUrl);
  expect(container!.querySelector(`a[href='/dispatch/${targetId}']`)).toBeNull();
  expect(container!.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);
  expect(await (await runs(request("/api/runs"))).json()).toEqual({ error: "Question history unavailable" });
});

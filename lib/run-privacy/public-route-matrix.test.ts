import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactNode } from "react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { SupabaseAdapter } from "../db/supabase-adapter";
import { RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { writeSqliteQueryRun } from "../db/query-run-record";
import type { QueryRun, Source } from "../types";
import { requirePrivacy, type PrivacyActor, type RunVisibility } from "./contracts";
import { researchReceiptDigest, verifyResearchReceipt } from "../research-receipt-integrity";
import { createTrustedUsageContext, newRunUsage } from "../research/usage-provenance";
import { usageWindow } from "../usage/contracts";

// Only acquisition/authentication/transport boundaries are replaced. Selectors,
// visibility, receipt projections, pages, metadata and HTTP exports remain real.
const boundary = vi.hoisted(() => {
  vi.stubEnv("BASE_URL", "https://privacy-matrix.example");
  vi.stubEnv("KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  return { db: vi.fn(), session: vi.fn(), account: vi.fn(), key: vi.fn(), archive: vi.fn(), client: vi.fn() };
});
vi.mock("@/lib/db", () => ({ getDb: boundary.db }));
vi.mock("@/lib/auth", () => ({ getSession: boundary.session }));
vi.mock("@/lib/account-sessions", () => ({ accountSessionContext: boundary.account }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: boundary.key }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: boundary.archive }));
vi.mock("@supabase/supabase-js", () => ({ createClient: boundary.client }));
vi.mock("@/lib/config", () => ({ config: {
  baseUrl: "https://privacy-matrix.example", networkId: "eip155:5042002",
  profile: { networkId: "eip155:5042002", testnet: true },
} }));

import { GET as runs } from "@/app/api/runs/route";
import { GET as feed } from "@/app/answers/feed.xml/route";
import sitemap from "@/app/sitemap";
import AnswersPage from "@/app/answers/page";
import AnswersPageN from "@/app/answers/page/[n]/page";
import TopicPage, { generateMetadata as topicMetadata } from "@/app/answers/topic/[slug]/page";
import DispatchPage, { generateMetadata as dispatchMetadata } from "@/app/dispatch/[id]/page";
import DispatchOgImage from "@/app/dispatch/[id]/opengraph-image";
import { GET as dispatch } from "@/app/api/dispatch/[id]/route";
import { GET as freshness } from "@/app/api/dispatch/[id]/freshness/route";
import { GET as outcomes } from "@/app/api/dispatch/[id]/purchase-outcomes/route";
import { GET as receipt } from "@/app/api/dispatch/[id]/receipt/route";
import { GET as activity } from "@/app/api/activity/route";
import { GET as payments } from "@/app/api/payments/route";
import { GET as creator } from "@/app/api/creator/[id]/route";
import CreatorPage, { generateMetadata as creatorMetadata } from "@/app/creator/[id]/page";
import { GET as creatorExport } from "@/app/api/creator/[id]/export/route";
import { GET as performance } from "@/app/api/creator/[id]/performance/route";
import { GET as learning } from "@/app/api/source/[id]/learning/route";
import { GET as wanted } from "@/app/api/wanted/route";
import { GET as ownerExport } from "@/app/api/me/run-privacy/[id]/export/route";
import { DELETE as ownerErase, PATCH as ownerChange } from "@/app/api/me/run-privacy/[id]/route";
import { getArchiveCached } from "../answers-archive-cache";
import { relatedAnswers, searchTerm } from "../answers-archive";
import { buildTopics, filterByTopic } from "../answers-topics";
import { ArchiveIndexView } from "@/components/keryx/archive-index-view";
import { ArchiveSearch } from "@/components/keryx/archive-search";
import { loadCitedSourceHistory } from "../sources/cited-source-history";
import { resolveDispatch, loadDispatchThread } from "../history/read-dispatch";

/* Reached surfaces (not an assertion of whole-epic delivery):
 * /api/runs, including classified network/period history;
 * /answers, /answers/page/[n], /answers/topic/[slug], archive search's
 * terms/others, related links, /answers/feed.xml, /sitemap.xml;
 * /dispatch/[id] page + metadata + opengraph-image;
 * /api/dispatch/[id], /freshness, /purchase-outcomes, /receipt;
 * /api/activity, /api/payments, /creator/[id] page + metadata,
 * /api/creator/[id], /export, /performance, /api/source/[id]/learning;
 * /api/wanted, cited-source history helper, dispatch parent/follow-up helper;
 * owner /api/me/run-privacy/[id] PATCH/DELETE and /export.
 * Reuse poll.test.ts for /api/agent/ask GET, testnet-archive.test.ts for
 * real immutable archive enumeration, and public-refusal.test.ts for outages.
 * No opt-in public run-owner profile exists here (#264); creator earnings
 * is a different profile. Portfolio CSV/auth, /history/testnet route rendering,
 * ingress/Ask/MCP and browser/Next cache delivery remain separate coverage.
 */
const origin = "https://privacy-matrix.example";
const network = "eip155:5042002" as const;
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const sessionHash = createHash("sha256").update("matrix-alice").digest("hex");
const actor: PrivacyActor = { wallet: alice, sessionHash, binding: { network, origin } };
const sourceId = "matrix-source";
const targetId = "matrix-target";
const sentinel = "HIDDENTEXT266";
let db: SqliteAdapter, connection: DatabaseSync;
let originals: Map<string, QueryRun>;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`${origin}${path}`, init);
// Inspect payload props, not React/module metadata (Next Link's type has a
// circular default). Every prop, including prop-embedded elements, is retained;
// unrelated data cycles still fail instead of being silently omitted.
const textOf = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => {
  if (!isValidElement<Record<string, unknown>>(item)) return item;
  return { type: typeof item.type === "string" ? item.type : undefined, key: item.key, props: item.props };
});

// Inspect the actual server-page return and its real search component inputs,
// without substituting UI components or claiming browser/RSC rendering acceptance.
function elements(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [{ type: node.type, props: node.props }, ...elements(node.props.children as ReactNode)];
}
function searchInputs(node: ReactNode): Array<{ terms: unknown; others: unknown }> {
  return elements(node).flatMap(element => {
    if (element.type === ArchiveIndexView) return searchInputs(ArchiveIndexView(element.props as unknown as Parameters<typeof ArchiveIndexView>[0]));
    return element.type === ArchiveSearch ? [{ terms: element.props.terms, others: element.props.others }] : [];
  });
}
function jsonLd(node: ReactNode) {
  return elements(node).filter(element => element.type === "script" && element.props.type === "application/ld+json")
    .map(element => (element.props.dangerouslySetInnerHTML as { __html: string }).__html);
}
async function responsePacket(response: Response) {
  return { status: response.status, headers: [...response.headers], body: await response.text() };
}
async function pageFailure(id: string) {
  try { await DispatchPage(params(id)); throw new Error("Expected Next notFound"); }
  catch (error) {
    const value = error as Error & { digest?: string };
    expect(value.digest).toContain("404");
    return { message: value.message, digest: value.digest };
  }
}
async function change(id: string, visibility: RunVisibility) {
  const state = (await requirePrivacy(db).owner(id, actor))!.state;
  return requirePrivacy(db).change(id, actor, { visibility, revision: state.revision, requestId: randomUUID() });
}
function save(id: string, question: string, index = 100, extra: Partial<QueryRun> = {}) {
  const run: QueryRun = {
    id, asker: alice, createdAt: new Date(Date.UTC(2026, 9, 11, 0, index)).toISOString(), question,
    answer: `Answer ${question} [S1]`, budget: 0.030001, engine: "heuristic",
    totalSpent: 0.012345, totalToCreators: 0.000001,
    subClaims: [`${question} measured claim`], decisions: [],
    citations: [{ marker: "S1", sourceId, sourceName: "Matrix source", weight: 1, reward: 0.000001, rationale: "Recorded fixture citation" }],
    trace: [], usage: newRunUsage({ usageContext: createTrustedUsageContext(network, { actor: "unknown", funding: "unknown", scripted: false }) }, network, []),
    ...extra,
  };
  writeSqliteQueryRun(connection, run, false);
  // The writer adds its canonical provenance; retain the exact stored original.
  originals.set(id, JSON.parse(String(connection.prepare("SELECT data FROM query_runs WHERE id=?").get(id)!.data)) as QueryRun);
  return run;
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet");
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in the privacy matrix"); }));
  originals = new Map();
  db = new SqliteAdapter(":memory:");
  await db.init();
  connection = (db as unknown as { db: DatabaseSync }).db;
  connection.exec(RUN_PRIVACY_SQL); // Source schema, on this owned :memory: handle only.
  await db.init();
  expect(db.runPrivacyActive).toBe(true);
  requirePrivacy(db);
  await db.createWebSession({ hash: sessionHash, wallet: alice, issuedAt: Date.now() - 1000, expiresAt: Date.now() + 120_000 });
  const source: Source = { id: sourceId, name: "Matrix source", url: "https://source.example", description: "In-memory fixture",
    walletAddress: bob, fetchPrice: 0.01, tags: [], authors: [], createdAt: "2026-10-11T00:00:00.000Z" };
  await db.upsertSource(source);
  // More than one real archive page; topic tokens occur in a non-ubiquitous subset.
  for (let i = 0; i < 62; i++) {
    const id = `control-${String(i).padStart(2, "0")}`;
    save(id, `${i < 4 ? "astronomy orbit" : "published control"} question ${i}`, i);
    await change(id, "public");
  }
  save(targetId, `${sentinel} confidential astronomy question`, 100, {
    decisions: [{ sourceId, sourceName: "Matrix source", action: "SKIP", expectedValue: 0.1, price: 0.01,
      confidence: 0.5, targets: [0], rationale: `${sentinel} decision` }],
    claimCoverage: [{ claimIndex: 0, claim: `${sentinel} confidential astronomy claim`, coverage: 0.1, coveredBy: [] }],
  });
  // All statuses and exact micro-USDC totals are synthetic recorded fixture
  // evidence. No provider, chain, signing, settlement or reconciliation occurs.
  for (const [index, status] of (["settled", "pending", "failed", "simulated"] as const).entries()) {
    await db.recordPayment({ id: `matrix-payment-${status}`, queryId: targetId, kind: "citation", sourceId, sourceName: "Matrix source",
      payer: alice, payee: bob, amountUsdc: (index + 1) / 1_000_000, network, settled: status === "settled", settlementStatus: status,
      txHash: status === "settled" ? "fixture-recorded-settlement" : null, weight: 1,
      rationale: `${sentinel} journal rationale`, authorizationId: "CUSTODIAN266-nonce", grantEpoch: "CUSTODIAN266-epoch",
      createdAt: originals.get(targetId)!.createdAt });
  }
  boundary.db.mockResolvedValue(db);
  boundary.archive.mockResolvedValue(null);
  boundary.session.mockResolvedValue(null);
  boundary.account.mockResolvedValue({ db, wallet: alice, currentId: sessionHash });
  boundary.key.mockResolvedValue(null);
});
afterEach(() => {
  db?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function enumeration() {
  const archive = await getArchiveCached();
  const index = await AnswersPage({ searchParams: Promise.resolve({}) });
  const older = await AnswersPageN({ params: Promise.resolve({ n: "2" }), searchParams: Promise.resolve({}) });
  const topic = await TopicPage({ params: Promise.resolve({ slug: "astronomy" }) });
  const ordinary = await runs(request("/api/runs"));
  const classified = await runs(request(`/api/runs?network=${network}&period=all`));
  expect(ordinary.status).toBe(200); expect(classified.status).toBe(200);
  const feedResponse = await feed();
  expect(feedResponse.headers.get("cache-control")).toBe("no-store");
  const map = await sitemap();
  const demand = await wanted(request("/api/wanted"));
  expect(demand.status).toBe(200);
  const sourceLearning = await learning(request(`/api/source/${sourceId}/learning`), params(sourceId));
  expect(sourceLearning.status).toBe(200);
  return {
    archive, index: { payload: textOf(index), search: searchInputs(index), structured: jsonLd(index) },
    older: { payload: textOf(older), search: searchInputs(older), structured: jsonLd(older) },
    topic: { payload: textOf(topic), search: searchInputs(topic), structured: jsonLd(topic) },
    topicMetadata: await topicMetadata({ params: Promise.resolve({ slug: "astronomy" }) }),
    topics: buildTopics(archive), topicEntries: filterByTopic(archive, "astronomy"), search: archive.map(searchTerm),
    related: relatedAnswers({ id: "outside-current", question: "astronomy", sourceNames: ["Matrix source"] }, archive, 100),
    runs: await ordinary.json(), classified: await classified.json(), feed: await feedResponse.text(),
    dispatchUrls: map.filter(row => new URL(row.url).pathname.startsWith("/dispatch/")), demand: await demand.json(),
    creatorProfile: textOf(await CreatorPage(params(sourceId))), creatorMetadata: await creatorMetadata(params(sourceId)),
    learning: await sourceLearning.json(),
  };
}

describe("#266 admitted SQLite public route matrix", () => {
  it.each(["private", "unlisted", "public"] as const)("selects %s before public paging, archive/search/topic/feed/sitemap and demand projection", async visibility => {
    if (visibility !== "private") await change(targetId, visibility);
    const result = await enumeration(), listed = visibility === "public";
    const hasTarget = (rows: Array<{ id: string }>) => rows.some(row => row.id === targetId);
    expect(hasTarget(result.archive)).toBe(listed);
    expect(hasTarget(result.runs)).toBe(listed); expect(hasTarget(result.classified)).toBe(listed);
    expect(result.dispatchUrls.some(row => new URL(row.url).pathname === `/dispatch/${targetId}`)).toBe(listed);
    expect(result.feed.includes(sentinel)).toBe(listed);
    expect(result.index.search).toHaveLength(1); expect(result.older.search).toHaveLength(1); expect(result.topic.search).toHaveLength(1);
    // Off-page search must still include every published entry; it must not smuggle hidden bodies.
    for (const value of [result.index, result.older, result.topic, result.search, result.related, result.demand])
      expect(textOf(value).toLowerCase().includes(sentinel.toLowerCase())).toBe(listed);
    expect(result.archive).toHaveLength(62 + Number(listed));
    expect(result.runs).toHaveLength(50); expect(result.classified).toHaveLength(50);
    expect(result.topics.some(topic => topic.slug === "astronomy")).toBe(true);
    expect(textOf(result.topics).includes(sentinel.toLowerCase())).toBe(false);
    // The source profile's server aggregate withholds private/unlisted activity;
    // its client earnings view uses the separately exercised creator API.
    expect(result.learning.historicalUnclassifiedRuns).toBe(Number(listed));
    expect(textOf([result.creatorProfile, result.creatorMetadata, result.learning])).not.toContain(sentinel);
    const feedback = await performance(request(`/api/creator/${sourceId}/performance`), params(sourceId));
    expect(feedback.status).toBe(200); expect((await feedback.text()).includes(sentinel)).toBe(listed);
  });

  it.each(["private", "unlisted", "public"] as const)("serves %s direct links with private/unknown outsider equivalence and actual owner page access", async visibility => {
    if (visibility !== "private") await change(targetId, visibility);
    for (const wallet of [null, bob]) {
      boundary.session.mockResolvedValue(wallet ? { address: wallet } : null);
      for (const handler of [dispatch, freshness]) {
        const actual = await handler(request(`/api/dispatch/${targetId}`), params(targetId));
        if (visibility === "private") expect(await responsePacket(actual)).toEqual(await responsePacket(await handler(request("/api/dispatch/unknown"), params("unknown"))));
        else expect(actual.status).toBe(200);
      }
      if (visibility === "private") expect(await pageFailure(targetId)).toEqual(await pageFailure("unknown"));
      else {
        const page = await DispatchPage(params(targetId));
        expect(textOf(page)).toContain(sentinel);
        expect(jsonLd(page).length > 0).toBe(visibility === "public");
      }
      const result = await outcomes(request(`/api/dispatch/${targetId}/purchase-outcomes`), params(targetId));
      if (visibility === "private") expect(await responsePacket(result)).toEqual(await responsePacket(await outcomes(request("/api/dispatch/unknown/purchase-outcomes"), params("unknown"))));
      else { expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ dispatchId: targetId }); }
    }
    boundary.session.mockResolvedValue({ address: alice });
    const owner = await dispatch(request(`/api/dispatch/${targetId}`), params(targetId));
    expect(owner.status).toBe(200); expect((await owner.json()).question).toBe(originals.get(targetId)!.question);
    expect(textOf(await DispatchPage(params(targetId)))).toContain(sentinel);
    const unknownMetadata = await dispatchMetadata(params("unknown"));
    const metadata = await dispatchMetadata(params(targetId));
    if (visibility === "public") expect(textOf(metadata)).toContain(sentinel);
    else expect(metadata).toEqual(unknownMetadata); // Metadata never acquires owner authority.
  });

  it("uses real local-font OG rendering: hidden/unlisted bytes match the same unknown ID, public bytes differ", async () => {
    const id = "matrix-social";
    // As in og-fonts.test.ts, Next acquires its embedded/local renderer WASM
    // through fetch. Serve those actual assets while refusing every network URL.
    const localFetch = vi.fn(async (input: RequestInfo | URL) => {
      const value = input instanceof Request ? input.url : String(input);
      if (value.startsWith("data:application/octet-stream;base64,"))
        return new Response(Buffer.from(value.split(",")[1], "base64"), { headers: { "Content-Type": "application/wasm" } });
      const url = new URL(value);
      if (url.protocol !== "file:") throw new Error("OG fixture forbids network access");
      return new Response(await readFile(fileURLToPath(url)), { headers: { "Content-Type": "application/wasm" } });
    });
    vi.stubGlobal("fetch", localFetch);
    const bytes = async () => {
      const response = await DispatchOgImage(params(id));
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      return createHash("sha256").update(body).digest("hex");
    };
    // Same ID avoids comparing the deliberately deterministic, caller-known serial.
    const unknown = await bytes();
    save(id, `${sentinel} social question`);
    expect(await bytes()).toBe(unknown);
    await change(id, "unlisted"); expect(await bytes()).toBe(unknown);
    await change(id, "public"); expect(await bytes()).not.toBe(unknown);
    await change(id, "private"); expect(await bytes()).toBe(unknown);
    expect(localFetch.mock.calls.every(([input]) => {
      const value = input instanceof Request ? input.url : String(input);
      return ["file:", "data:"].includes(new URL(value).protocol);
    })).toBe(true);
  }, 30_000);

  it("rechecks previously published bodies after unlisting, privatizing and erasing with no retained archive/search/metadata payload", async () => {
    await change(targetId, "public"); expect(textOf(await enumeration())).toContain(sentinel);
    for (const visibility of ["unlisted", "private"] as const) {
      await change(targetId, visibility);
      expect(textOf(await enumeration())).not.toContain(sentinel);
      expect(await dispatchMetadata(params(targetId))).toEqual(await dispatchMetadata(params("unknown")));
      const response = await dispatch(request(`/api/dispatch/${targetId}`), params(targetId));
      expect(response.status).toBe(visibility === "unlisted" ? 200 : 404);
    }
    await change(targetId, "public"); expect(textOf(await enumeration())).toContain(sentinel);
    const state = (await requirePrivacy(db).owner(targetId, actor))!.state;
    await requirePrivacy(db).erase(targetId, actor, { revision: state.revision, requestId: randomUUID() });
    expect(textOf(await enumeration())).not.toContain(sentinel);
    expect(await responsePacket(await dispatch(request(`/api/dispatch/${targetId}`), params(targetId))))
      .toEqual(await responsePacket(await dispatch(request("/api/dispatch/unknown"), params("unknown"))));
  });

  it("does not resurrect hidden/erased current IDs through an older archive duplicate; historical-only links retain unlisted authority", async () => {
    const archiveRead = vi.fn(async (id: string) => id === targetId || id === "historical-only" ? { ...originals.get(targetId)!, id, question: "ARCHIVE266 old text" } : null);
    boundary.archive.mockResolvedValue({ getQueryRun: archiveRead, info: {
      network, label: "Arc testnet", capturedAt: "2026-09-01T00:00:00.000Z", sourceCommit: "a".repeat(40), databaseSha256: "b".repeat(64),
    } });
    expect(await resolveDispatch(targetId, db)).toBeNull(); expect(archiveRead).not.toHaveBeenCalled();
    await change(targetId, "unlisted"); expect((await resolveDispatch(targetId, db))?.archive).toBeNull();
    await change(targetId, "public"); expect((await resolveDispatch(targetId, db))?.archive).toBeNull();
    await requirePrivacy(db).erase(targetId, actor, { revision: 2, requestId: randomUUID() });
    expect(await resolveDispatch(targetId, db)).toBeNull(); expect(archiveRead).not.toHaveBeenCalled();
    const historical = await resolveDispatch("historical-only", db);
    expect(historical).toMatchObject({ visibility: "unlisted", run: { question: "ARCHIVE266 old text" } });
    expect(archiveRead).toHaveBeenCalledExactlyOnceWith("historical-only");
  });

  it("keeps private/unlisted parents, follow-ups and cited-document discovery out of public enrichment", async () => {
    for (const visibility of ["private", "unlisted", "public"] as const) {
      const id = `child-${visibility}`;
      save(id, `${visibility} child ${sentinel}`, 101, { parentId: targetId, citations: [{
        marker: "S1", sourceId, sourceName: "Matrix source", sourceKind: "public-reference", weight: 1, reward: 0,
        rationale: "Fixture", itemTitle: `${visibility} cited document`, itemUrl: `https://documents.example/${visibility}`,
      }] });
      if (visibility !== "private") await change(id, visibility);
    }
    await change(targetId, "unlisted");
    const root = (await resolveDispatch(targetId, db))!;
    expect((await loadDispatchThread(root, db)).followUps.map(row => row.run.id)).toEqual(["child-public"]);
    expect((await loadCitedSourceHistory(db)).entries.map(row => row.runId)).toEqual(["child-public"]);
    const child = (await resolveDispatch("child-public", db))!;
    expect((await loadDispatchThread(child, db)).parent?.run.id).toBe(targetId); // Unlisted direct parent link is allowed.
    await change(targetId, "private");
    expect((await loadDispatchThread(child, db)).parent).toBeNull();
    expect((await loadDispatchThread(child, db, actor)).parent?.run.id).toBe(targetId);
  });

  it("audits successful owner HTTP export/delete and preserves exact journal rows, counters, creator totals and settlement digest across all levels", async () => {
    boundary.session.mockResolvedValue({ address: alice });
    const window = usageWindow(new URLSearchParams("period=all"), network, new Date("2026-11-01T00:00:00.000Z"));
    const financialSnapshot = async () => ({
      journals: connection.prepare("SELECT * FROM payment_events ORDER BY id").all(),
      counters: connection.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs ORDER BY id").all(),
      leaderboard: await db.creatorLeaderboard(), summary: await db.publicUsage!.summary(window),
      publicPayments: await (await payments(request("/api/payments"))).json(),
    });
    const before = await financialSnapshot();
    const readCreator = async () => {
      const response = await creator(request(`/api/creator/${sourceId}`), params(sourceId));
      expect(response.status).toBe(200); return response.json();
    };
    const readExport = async () => {
      const response = await creatorExport(request(`/api/creator/${sourceId}/export?format=json`), params(sourceId));
      expect(response.status).toBe(200); return response.json();
    };
    const creatorBefore = await readCreator(), exportBefore = await readExport();
    const proofs: unknown[] = [];
    for (const visibility of ["private", "unlisted", "public"] as const) {
      if (visibility !== "private") {
        const state = (await requirePrivacy(db).owner(targetId, actor))!.state;
        const result = await ownerChange(request(`/api/me/run-privacy/${targetId}`, { method: "PATCH",
          headers: { Origin: origin, "X-Keryx-Expected-Wallet": alice, "Content-Type": "application/json" },
          body: JSON.stringify({ visibility, revision: state.revision, requestId: randomUUID() }) }), params(targetId));
        expect(result.status).toBe(200);
      }
      const requestId = randomUUID();
      const result = await ownerExport(request(`/api/me/run-privacy/${targetId}/export`, { headers: { "X-Keryx-Request-Id": requestId } }), params(targetId));
      expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
      const packet = await result.json(); expect(packet.run).toEqual(originals.get(targetId));
      expect(packet.payments).toHaveLength(4); expect(textOf(packet.payments)).not.toMatch(/CUSTODIAN266|HIDDENTEXT266/);
      const audit = connection.prepare("SELECT action,wallet,run_id,original_digest FROM run_privacy_audit WHERE request_id=?").get(requestId);
      expect(audit).toMatchObject({ action: "export", wallet: alice, run_id: targetId,
        original_digest: createHash("sha256").update(String(connection.prepare("SELECT data FROM query_runs WHERE id=?").get(targetId)!.data)).digest("hex") });
      const proofResponse = await receipt(request(`/api/dispatch/${targetId}/receipt`), params(targetId));
      expect(proofResponse.status).toBe(200); const proof = await proofResponse.json();
      if (visibility === "public") { expect(verifyResearchReceipt(proof).valid).toBe(true); expect(textOf(proof)).toContain(sentinel); }
      else {
        const { integrity, ...payload } = proof;
        expect(proof.schema).toBe("urn:keryx:settlement-receipt:1"); expect(integrity.digest).toBe(researchReceiptDigest(payload));
        expect(textOf(proof)).not.toMatch(/HIDDENTEXT266|CUSTODIAN266/); proofs.push(proof);
      }
      const profile = await readCreator(), exported = await readExport();
      expect(profile.stats).toEqual(creatorBefore.stats); expect(profile.dailyEarnings).toEqual(creatorBefore.dailyEarnings);
      expect(exported.summary).toEqual(exportBefore.summary);
      expect(profile.recentPayments.every((row: { question: string | null }) => visibility === "public" ? row.question === originals.get(targetId)!.question : row.question === null)).toBe(true);
      const event = await activity(); expect((await event.text()).includes(sentinel)).toBe(visibility === "public");
      expect(textOf(exported.payments).includes(sentinel)).toBe(visibility === "public");
      expect(await financialSnapshot()).toEqual(before);
    }
    expect(proofs[0]).toEqual(proofs[1]);
    const requestId = randomUUID();
    const erased = await ownerErase(request(`/api/me/run-privacy/${targetId}`, { method: "DELETE",
      headers: { Origin: origin, "X-Keryx-Expected-Wallet": alice, "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 2, requestId }) }), params(targetId));
    expect(erased.status).toBe(200); expect(await erased.json()).toEqual({ visibility: "private", revision: 3, erased: true });
    expect(connection.prepare("SELECT action,wallet,run_id FROM run_privacy_audit WHERE request_id=?").get(requestId))
      .toMatchObject({ action: "erase", wallet: alice, run_id: targetId });
    expect(textOf(connection.prepare("SELECT data,question,answer FROM query_runs WHERE id=?").get(targetId))).not.toContain(sentinel);
    expect(await financialSnapshot()).toEqual(before);
    const after = await (await receipt(request(`/api/dispatch/${targetId}/receipt`), params(targetId))).json();
    expect(after).toEqual(proofs[0]);
    expect((await readCreator()).stats).toEqual(creatorBefore.stats); expect((await readExport()).summary).toEqual(exportBefore.summary);
  });
});

it("qualifies synthetic Supabase fixed-RPC wiring with the real SQLite visibility control, never as enrolled/real Postgres acceptance", async () => {
  // Transport control delegates policy to the real admitted SQLite store. It does
  // not invent a second predicate or claim to execute 0090's PostgreSQL function.
  const sqlite = requirePrivacy(db);
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    expect(name).toBe("run_privacy_v1"); expect(signal).toBeInstanceOf(AbortSignal); expect(args.p_claims).toBe(false);
    const id = args.p_id as string, who = args.p_actor as PrivacyActor | null;
    let result: unknown;
    switch (args.p_action) {
      case "read": {
        const value = await sqlite.read(id, who ?? undefined);
        // Match 0090's strict RPC item; SQLite's owner read also carries an
        // internal current-row snapshot that is not part of this wire packet.
        result = { exists: value.exists, item: value.item ? { run: value.item.run, state: value.item.state } : null };
        break;
      }
      case "list": result = await Promise.all((await sqlite.list(args.p_input as Parameters<typeof sqlite.list>[0]))
        .map(async run => ({ run, state: (await sqlite.read(run.id)).item!.state }))); break;
      default: throw new Error(`Unexpected fixture RPC ${String(args.p_action)}`);
    }
    return { data: { version: 1, action: args.p_action, id: args.p_id, result }, error: null };
  } }));
  // Provenance lookup only: the actual adapter may consult public source flags.
  // Every text-bearing/raw original REST acquisition is refused by this fixture.
  const from = vi.fn((table: string) => {
    expect(["sources", "source_items"]).toContain(table);
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder); builder.eq = vi.fn(() => builder);
    builder.in = vi.fn(async () => ({ data: [], error: null }));
    return builder;
  });
  boundary.client.mockReturnValue({ rpc, from });
  const supabase = new SupabaseAdapter();
  boundary.db.mockResolvedValue(supabase);
  for (const visibility of ["private", "unlisted", "public"] as const) {
    if (visibility !== "private") await change(targetId, visibility);
    const listed = (await supabase.listRecentQueries(100)).some(run => run.id === targetId);
    expect(listed).toBe(visibility === "public");
    expect((await Array.fromAsync(supabase.iterateRecentQueries(100))).some(run => run.id === targetId)).toBe(visibility === "public");
    for (const wallet of [null, bob, alice]) {
      boundary.session.mockResolvedValue(wallet ? { address: wallet } : null);
      const response = await dispatch(request(`/api/dispatch/${targetId}`), params(targetId));
      expect(response.status).toBe(visibility === "private" && wallet !== alice ? 404 : 200);
      if (response.status === 200) expect((await response.json()).question).toBe(originals.get(targetId)!.question);
      else expect(await responsePacket(response)).toEqual(await responsePacket(await dispatch(request("/api/dispatch/unknown"), params("unknown"))));
    }
  }
  expect(rpc.mock.calls.some(([, args]) => (args.p_actor as PrivacyActor | null)?.wallet === bob)).toBe(true);
  expect(from.mock.calls.every(([table]) => table === "sources" || table === "source_items")).toBe(true);
  boundary.db.mockResolvedValue(db);
});

/** Actual scenario composition for R19–R24. Synthetic evidence is never live acceptance. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { encodeFunctionResult } from "viem";
import { replayExtensionPopup } from "../display/extension-popup.test-fixture";
import type { QueryRun, Source, SourceItem } from "../types";
import type { BrowserSourceOriginalAdmission } from "../db/browser-signing-originals";
import type { ReasoningEngine } from "../llm/reasoning-engine";
import type { PaymentGateway } from "../payments/payment-gateway";

const transport = vi.hoisted(() => ({ feed: vi.fn(), db: vi.fn() }));
vi.mock("../net/public-fetch", () => ({ fetchPublicText: transport.feed }));
vi.mock("../db", () => ({ getDb: transport.db }));
vi.mock("../config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, registryAddress: undefined, registryReadAddress: undefined,
    funderKey: "", baseUrl: "https://keryx.example", externalDiscovery: false } };
});

import { SqliteAdapter } from "../db/sqlite-adapter";
import { prepareSourceRegistration } from "../sources/prepare-registration";
import { verificationToken } from "../sources/feed-verification-token";
import { createSyntheticBrowserOriginalSourceAuthority, prepareBrowserSourceSigningAdmission } from "../payments/browser-original-source-authority";
import { browserSourceRegistryId } from "../payments/browser-original-source-context";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { sourceItemContentVersion, sourceItemIdentity } from "../sources/source-item-asset";
import { runAgent } from "../agent/run-agent";
import { makePayment } from "../payments/payment-gateway";
import { PaymentSettledError } from "../payments/payment-state";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { surfaceResearch } from "../research/surface-result";
import { exportsFromCheckedReceipt } from "../research/receipt-exports";
import { remoteResearchResult } from "../mcp/remote-server";
import { keryxMeta } from "../openai-compat";
import { a2aResponseFromRun } from "../a2a/result";
import { quoteA2aResearch } from "../a2a/pricing";
import { researchReportMarkdown } from "../research-report-export";
import { buildAnswerText } from "../telegram/ask-message";
import { buildAnswerMessage } from "../discord/ask-interaction";
import { savePrivateExport } from "../../desktop/src/private-export";
import { GET as getReceipt } from "../../app/api/dispatch/[id]/receipt/route";
import { createBuyerJournal } from "../buyer/journal";
import { authorizationWithNonce, BUYER_USDC, BUYER_GATEWAY } from "../buyer/protocol";
import { buyerJobId } from "../buyer/policy";
import { resumeResearch } from "../buyer/client";
import { commerceDirectory, commerceEnvironment, monthlyFixture, pendingOriginal, SYNTHETIC_NETWORK,
  SYNTHETIC_PAYER, SYNTHETIC_PAYEE, writeCommerceArtifact } from "./commerce-workload";

const nativeFetch = globalThis.fetch;
let networkCalls = 0;
beforeEach(() => {
  networkCalls = 0;
  transport.feed.mockReset();
  transport.db.mockReset();
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Commerce workload forbids external network");
    networkCalls++;
    return nativeFetch(input, init);
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function database(id: string) {
  const db = new SqliteAdapter(path.join(commerceDirectory(), `${id}.sqlite`));
  await db.init();
  return db;
}
function record(id: string, criteria: string[], observations: unknown, unexecuted: string[]) {
  const observedChecks: Record<string, string[]> = {
    R19: ["Controlled XML registration only; publisher-owned staging/testnet criterion remains open.",
      "Listing rows and article scope checked; payment table is empty.", "Authenticated-wallet fixture controls payout; foreign feed token leaves registrant unverified."],
    R20: ["Only a loopback synthetic registry was mutated; no production source was touched.",
      "Old payee resolution refused; fresh payee resolved from a new registry read.", "Original source/item/input bytes unchanged; altered content version refused."],
    R21: ["New-process before/empty observations retain the original nonce and expired pending liability.",
      "One original ledger row before and after; recovery accepts only injected reads, with no submission capability.",
      "Foreign recipient evidence leaves pending; exact terminal tuple promotes once; next scan finds no pending row."],
    R22: ["Failed source's 0.004 synthetic settled access debit remains in payment rows and portable receipt.",
      "Only available source appears in evidence/citations/reward calls.", "Available source excerpt survives; trace retains paid-delivery failure."],
    R23: ["Entitlement and original order live only in an isolated SQLite fixture.",
      "Started and failed original both replay without creation; the same one slot remains consumed after expiry.",
      "Restarted worker cannot reclaim original; payment table stays empty and original purchase remains identical."],
    R24: ["One saved source/version/abstract scope and pending liability survive adapters and checked receipt exports.",
      "Extension and bot formatters hand off to original dispatch; surfaceRoles records native/package limits.",
      "CLI/stdio recovery requests are GET-only without payment headers; render/export makes no external request."],
  };
  writeCommerceArtifact(`${id}.json`, { id, taskAcceptance: "partial-synthetic-only", criteria: criteria.map((criterion, index) =>
    ({ index: index + 1, criterion, observed: observedChecks[id][index], evidence: "#/value/observations", scope: "synthetic-only" })), observations, unexecuted });
}
const criteria = new Map((JSON.parse(fs.readFileSync("docs/research-workload.json", "utf8")) as {
  cases: { id: string; acceptance: string[] }[] }).cases.map(item => [item.id, item.acceptance]));

it("R19 registers a controlled feed, checks payout/ownership and leaves listing economics empty", async () => {
  const db = await database("R19");
  const rssUrl = "https://synthetic-publisher.example/rss.xml";
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Controlled R19 publisher</title>
    <link>https://synthetic-publisher.example/</link><description>Research fixture ${verificationToken(SYNTHETIC_PAYEE)}</description>
    <item><title>Original R19 article</title><link>https://synthetic-publisher.example/article</link>
    <description>Only a synthetic abstract is supplied.</description></item></channel></rss>`;
  transport.feed.mockImplementation(async (url: string) => { expect(url).toBe(rssUrl); return xml; });
  try {
    const result = await prepareSourceRegistration(db, SYNTHETIC_PAYEE, { rssUrl, fetchPrice: 0.004,
      walletAddress: SYNTHETIC_PAYER }); // caller field cannot override authenticated payout
    expect(result.status).toBe(200);
    const source = (await db.listSources())[0];
    expect(source).toMatchObject({ name: "Controlled R19 publisher", walletAddress: SYNTHETIC_PAYEE, verified: true,
      rssUrl, url: "https://synthetic-publisher.example/", fetchPrice: 0.004 });
    expect(source.description).not.toContain("keryx-verify");
    const items = await db.getItems(source.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceId: source.id, title: "Original R19 article", deliveryKind: "abstract" });
    const foreign = await prepareSourceRegistration(db, SYNTHETIC_PAYER, { rssUrl });
    expect(foreign.payload.source).toMatchObject({ walletAddress: SYNTHETIC_PAYER, verified: false });
    expect(await db.listPayments(10)).toEqual([]);
    expect(networkCalls).toBe(0);
    record("R19", criteria.get("R19")!, { source, items, foreignClaim: foreign.payload, payments: 0,
      proofAuthority: "controlled XML and injected authenticated wallet only; not external ownership", feedReads: transport.feed.mock.calls.length },
    ["Real publisher-owned staging feed", "SIWE/browser authentication", "testnet custody and on-chain registration/indexing"]);
  } finally { db.close(); }
});

it("R20 refuses a changed registry payout before admitting the original source authorization", async () => {
  let registryPayout = SYNTHETIC_PAYEE;
  const source: Source = { id: "R20-source", name: "R20 publisher", url: "https://r20.example/", description: "synthetic",
    walletAddress: SYNTHETIC_PAYEE, fetchPrice: .001, tags: [], authors: [], createdAt: new Date().toISOString(), active: true, verified: true,
    onchainId: browserSourceRegistryId(SYNTHETIC_PAYER, "https://r20.example/") };
  const item: SourceItem = { id: "R20-item", sourceId: source.id, title: "Original", summary: "Original preview",
    content: "Original controlled content", link: "https://r20.example/original" };
  const queryId = crypto.randomUUID(), epoch = crypto.randomUUID();
  const input: BrowserSourceOriginalAdmission = { protocol: "durable-v3", queryNamespace: `0x${"33".repeat(32)}`, queryId,
    source: { sourceId: source.id, itemId: item.id, contentVersion: sourceItemContentVersion(item), offerId: null },
    journal: { sessionId: SYNTHETIC_PAYER, requestId: crypto.randomUUID(), queryId, grantEpoch: epoch, signer: SYNTHETIC_PAYER,
      network: SYNTHETIC_NETWORK, token: BUYER_USDC, gatewayContract: BUYER_GATEWAY, sourceId: source.id, offerId: null,
      kind: "fetch", payee: SYNTHETIC_PAYEE, amountMicroUsdc: 1000, requirements: { scheme: "exact", network: SYNTHETIC_NETWORK,
        asset: BUYER_USDC, amount: "1000", payTo: SYNTHETIC_PAYEE, maxTimeoutSeconds: 691200,
        extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } },
      payment: { kind: "fetch", queryId, sourceId: source.id, sourceName: source.name, payer: SYNTHETIC_PAYER,
        payee: SYNTHETIC_PAYEE, amountUsdc: .001, network: SYNTHETIC_NETWORK, grantEpoch: epoch,
        itemId: item.id, contentVersion: sourceItemContentVersion(item) } } };
  const original = JSON.stringify({ source, item, input });
  const methods: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString());
    methods.push(rpc.method);
    const result = rpc.method === "eth_chainId" ? "0x4cef52" : rpc.method === "eth_call" ? encodeFunctionResult({
      abi: REGISTRY_ABI, functionName: "get", result: { creator: SYNTHETIC_PAYER as `0x${string}`,
        payoutWallet: registryPayout as `0x${string}`, authors: [], fetchPriceUsdc6: BigInt(1000), contentCid: "", tags: "", active: true } }) :
      { number: "0x1", hash: `0x${"44".repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: [] };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Synthetic RPC unavailable");
    const authority = createSyntheticBrowserOriginalSourceAuthority({ getSource: async () => source, getItem: async () => item,
      getArticleOffer: async () => null }, `http://127.0.0.1:${address.port}`, SYNTHETIC_PAYEE);
    const first = prepareBrowserSourceSigningAdmission(input, await authority.resolve(input));
    registryPayout = `0x${"3".repeat(40)}`;
    await expect(authority.resolve(input)).rejects.toThrow("refused");
    expect(JSON.stringify({ source, item, input })).toBe(original);
    const fresh = structuredClone(input);
    fresh.journal.payee = fresh.journal.requirements.payTo = fresh.journal.payment.payee = registryPayout;
    const freshAdmission = prepareBrowserSourceSigningAdmission(fresh, await authority.resolve(fresh));
    expect(freshAdmission.input.sourceContext.registry.payoutWallet).toBe(registryPayout);
    const changedVersion = structuredClone(input); changedVersion.source.contentVersion = "sha256:changed";
    await expect(authority.resolve(changedVersion)).rejects.toThrow("refused");
    expect(methods.every(method => ["eth_chainId", "eth_call", "eth_getBlockByNumber"].includes(method))).toBe(true);
    record("R20", criteria.get("R20")!, { originalAdmission: first, freshAdmission, originalUnchanged: true,
      stalePayoutRefused: true, changedVersionRefused: true, rpcMethods: methods, signedOrSubmitted: 0 },
    ["Real RPC/network authority", "browser signing UI", "testnet transaction"]);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it("R21 reopens a lost response in a new process and reconciles only exact terminal evidence", async () => {
  const db = await database("R21");
  try { await db.recordPayment(pendingOriginal()); } finally { db.close(); }
  const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval-commerce-workload.mts", "--recover-original"], {
    cwd: process.cwd(), env: commerceEnvironment(commerceDirectory()), encoding: "utf8", timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
  expect(child.status, child.stderr + child.stdout).toBe(0);
  const recovered = JSON.parse(fs.readFileSync(path.join(commerceDirectory(), "R21-recovery.json"), "utf8")).value;
  expect(recovered.childPid).not.toBe(process.pid);
  expect(recovered.after).toHaveLength(1);
  expect(recovered.after[0]).toMatchObject({ authorizationId: pendingOriginal().authorizationId, settlementStatus: "settled",
    itemId: "R21-article", contentVersion: "sha256:R21-retained-version" });
  record("R21", criteria.get("R21")!, { ...recovered, producerPid: process.pid,
    submittedResponse: "lost by construction; durable pending original recorded before process exit" },
  ["Actual transport submission/loss", "live Circle terminal evidence", "browser grant capacity recovery"]);
});

it("R22 keeps a settled access debit after failed delivery and continues from another source", async () => {
  const db = await database("R22");
  const sources: Source[] = ["failed", "available"].map(id => ({ id: `R22-${id}`, name: `R22 ${id}`,
    url: `https://${id}.example/`, description: "Controlled research delivery evidence", walletAddress: SYNTHETIC_PAYEE,
    fetchPrice: .004, tags: ["delivery"], authors: [{ name: id, walletAddress: SYNTHETIC_PAYEE, splitWeight: 1 }],
    createdAt: new Date().toISOString(), active: true, verified: true }));
  const items: SourceItem[] = sources.map(source => ({ id: `${source.id}-item`, sourceId: source.id, title: "Delivery evidence",
    summary: source.id.endsWith("failed") ? "Failed delivery cause" : "Available evidence continuity", content: "Useful evidence survives an unavailable adjacent source.",
    link: `${source.url}article`, deliveryKind: "full_text" }));
  const citationCalls: string[] = [];
  const gateway: PaymentGateway = { mode: "real", agentAddress: () => SYNTHETIC_PAYER,
    ensureFunded: async () => ({ address: SYNTHETIC_PAYER }),
    async payFetch({ source, item, queryId }) {
      const payment = makePayment({ id: `synthetic:${source.id}`, kind: "fetch", queryId, sourceId: source.id, sourceName: source.name,
        ...sourceItemIdentity(item!), payer: SYNTHETIC_PAYER, payee: source.walletAddress, amountUsdc: source.fetchPrice,
        settled: true, settlementStatus: "settled", txHash: `synthetic-debit-${source.id}`, authorizationId: `synthetic-nonce-${source.id}` });
      if (source.id.endsWith("failed")) throw new PaymentSettledError("synthetic delivery lost after debit", payment);
      return { content: item!.content, payment };
    },
    async payCitation({ source, item, queryId, amount, weight, rationale }) {
      citationCalls.push(source.id);
      return makePayment({ id: `synthetic:citation:${source.id}`, kind: "citation", queryId, sourceId: source.id,
        sourceName: source.name, ...item, payer: SYNTHETIC_PAYER, payee: source.walletAddress, amountUsdc: amount, weight, rationale,
        settled: true, settlementStatus: "settled", txHash: `synthetic-reward-${source.id}` });
    } };
  const engine: ReasoningEngine = { name: "R22-controlled-fault-injection", decompose: async () => ["Failed delivery cause", "Available evidence continuity"],
    decide: async input => input.candidates.map(candidate => ({ sourceId: candidate.id, sourceName: candidate.name, action: "BUY",
      expectedValue: .9, price: candidate.fetchPrice, confidence: .9, rationale: "Read controlled delivery evidence", targets: [candidate.name.includes("failed") ? 0 : 1] })),
    sufficiency: async input => ({ sufficient: false, rationale: "Unavailable-source dimension remains unresolved", perClaim: input.subClaims.map((claim, index) =>
      ({ claim, coverage: index === 1 ? .9 : 0, coveredBy: index === 1 ? input.gathered.map(item => item.marker) : [] })) }),
    reevaluate: async () => ({ claims: [], shouldBuyMore: false, recommendedIds: [], rationale: "No additional attempts" }),
    synthesize: async input => ({ answer: input.gathered.map(item => `[${item.marker}] ${item.text}`).join("\n"),
      citedMarkers: input.gathered.map(item => item.marker), conflicts: [], evidence: input.gathered.map(item =>
        ({ claimIndex: 1, marker: item.marker, quote: item.text, quoteSpan: { start: 0, end: item.text.length }, support: .9 })) }),
    attribute: async input => input.used.map(item => ({ sourceId: item.sourceId, weight: 1 / input.used.length, rationale: "Read source" })) };
  try {
    for (const source of sources) await db.upsertSource(source);
    await db.addItems(items);
    const generator = runAgent({ question: "Controlled research delivery evidence", budget: .05 }, { db, gateway, engine,
      effects: { scope: { kind: "public" }, recordPayment: p => db.recordPayment(p), getCached: key => db.getCached(key),
        getCachedAt: key => db.getCachedAt(key), setCached: (key, body) => db.setCached(key, body), saveQueryRun: run => db.saveQueryRun(run),
        discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }), saveMemory: async () => {}, notifyCitation: () => {},
        alert: () => {}, activation: async () => {} } });
    const trace = [];
    let next = await generator.next();
    while (!next.done) { trace.push(next.value); next = await generator.next(); }
    const run = next.value;
    const payments = await db.listCreatorPaymentAttemptsByQuery(run.id);
    writeCommerceArtifact("R22-execution.json", { run, trace, payments });
    expect(payments.find(p => p.sourceId === "R22-failed")).toMatchObject({ kind: "fetch", settled: true, amountUsdc: .004 });
    expect(run.citations.map(c => c.sourceId)).toEqual(["R22-available"]);
    expect(run.evidence?.every(e => e.sourceId === "R22-available")).toBe(true);
    expect(run.answer).toContain("Useful evidence survives");
    expect(citationCalls).not.toContain("R22-failed");
    expect(trace.some(step => step.message.includes("content response failed after settlement"))).toBe(true);
    const receipt = buildResearchReceipt(run, payments);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(receipt.payload.settlement.settledAccessUsdc).toBe(.008);
    expect(networkCalls).toBe(0);
    record("R22", criteria.get("R22")!, { run, trace, payments, receipt, citationCalls,
      settlementAuthority: "Injected fault gateway models settled-control-flow; no network settlement occurred" },
    ["Real x402 settlement response", "seller/IPFS delivery outage", "live balance reconciliation"]);
  } finally { db.close(); }
});

it("R23 preserves one Monthly slot and the same started/failed order across restart and exact replay", async () => {
  const { purchase, order, requestId } = await monthlyFixture();
  const input = { monthlyId: purchase.id, payer: purchase.payer, requestId, now: purchase.createdAt, order };
  let db = await database("R23");
  try {
    await db.createResearchMonthly(purchase);
    expect((await db.redeemResearchMonthly(input)).created).toBe(true);
    expect((await db.claimNextA2aOrder("synthetic-worker-before-interruption", purchase.createdAt))?.id).toBe(order.id);
    expect(await db.markA2aOrderPaymentStarted(order.id, purchase.createdAt)).toBe(true);
    db.close(); db = await database("R23");
    const replay = await db.redeemResearchMonthly(input);
    expect(replay.created).toBe(false);
    expect(replay.order.id).toBe(order.id);
    expect(replay.order.paymentStartedAt).toBe(purchase.createdAt);
    expect(await db.claimNextA2aOrder("synthetic-restarted-worker", purchase.createdAt)).toBeNull();
    expect((await db.getResearchMonthly(purchase.id))?.redemptions).toHaveLength(1);
    expect(await db.failA2aOrder(order.id, "synthetic_interrupted_reviewed", purchase.createdAt)).toBe(true);
    const afterFailure = await db.redeemResearchMonthly({ ...input, now: purchase.expiresAt });
    expect(afterFailure).toMatchObject({ created: false, order: { id: order.id, status: "failed" } });
    const entitlement = await db.getResearchMonthly(purchase.id);
    expect(entitlement?.redemptions).toHaveLength(1);
    expect(entitlement?.purchase).toEqual(purchase);
    expect(await db.listPayments(10)).toEqual([]);
    record("R23", criteria.get("R23")!, { replay, afterFailure, entitlement, newPaymentRows: 0, workerReclaim: null,
      interruption: "Closed and reopened SQLite after durable worker claim/payment boundary; no worker execution supplied" },
    ["Paid Monthly purchase", "real worker interruption", "multi-host Supabase deployment"]);
  } finally { db.close(); }
});

it("R24 retains identities/read limits through result, recovery and export adapters without new payment", async () => {
  const request = { question: "R24 retained synthetic abstract", budget: .03, researchMode: "quick" as const,
    packageVersion: "1.0.0" as const, responseMode: "async" as const };
  const requirement = { scheme: "exact" as const, network: SYNTHETIC_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: SYNTHETIC_PAYEE,
    maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched" as const, version: "1" as const, verifyingContract: BUYER_GATEWAY } };
  const authorization = authorizationWithNonce(SYNTHETIC_PAYER, requirement, `0x${"b".repeat(64)}`);
  const id = buyerJobId(authorization);
  const asset = { sourceKind: "public-reference" as const, itemId: "R24-article", itemTitle: "Controlled abstract", itemUrl: "https://R24.example/abstract",
    contentVersion: `sha256:${"c".repeat(64)}`, evidenceProvenance: "synthetic-demo" as const,
    scholarly: { provider: "arxiv" as const, recordUrl: "https://R24.example/metadata", retrievedAt: "2026-10-04T00:00:00.000Z",
      title: "Controlled abstract", authors: ["Fixture author"], workType: "preprint" as const, peerReview: "unknown" as const,
      evidenceScope: "abstract-page" as const } };
  const run: QueryRun = { id, question: request.question, budget: .03, researchMode: "quick", engine: "synthetic-fixture", paymentMode: "real",
    answer: "Illustrative demo content [P1]. Only the controlled abstract was read.", subClaims: ["Controlled abstract scope"], decisions: [],
    citations: [{ ...asset, marker: "P1", sourceId: "public:R24", sourceName: "R24 fixture", weight: 1, reward: 0, rationale: "Retained fixture" }],
    evidence: [{ ...asset, claimIndex: 0, claim: "Controlled abstract scope", marker: "P1", sourceId: "public:R24", sourceName: "R24 fixture",
      quote: "Only the controlled abstract was read.", support: 0, qualifiesForAnswer: false, qualifiesForReward: false }],
    totalSpent: 0, totalToCreators: 0, pendingSpendUsdc: .004001, settledPayments: 0, pendingPayments: 1, trace: [], createdAt: "2026-10-04T00:00:00.000Z" };
  const pending = { ...pendingOriginal(), queryId: id };
  const receipt = buildResearchReceipt(run, [pending]);
  const baseline = surfaceResearch(run);
  const a2a = a2aResponseFromRun(run, quoteA2aResearch(.03, "quick"), { acceptedAt: run.createdAt, startedAt: run.createdAt });
  const projected = { web: baseline, remoteMcp: remoteResearchResult(run), openAiApi: keryxMeta(run), a2a };
  for (const result of Object.values(projected)) {
    expect(result.citations[0]).toMatchObject({ itemId: asset.itemId, contentVersion: asset.contentVersion,
      scholarly: { evidenceScope: "abstract-page" } });
    expect(result.evidence[0]).toMatchObject({ qualifiesForAnswer: false, qualifiesForReward: false });
    expect(result.pendingSpendUsdc).toBe(.004001);
    expect(result.creatorsPaid).toBeNull();
    expect(result.researchExports).toEqual(baseline.researchExports);
  }
  const retained = await database("R24");
  let apiReceipt;
  try {
    await retained.saveQueryRun(run);
    await retained.recordPayment(pending);
    transport.db.mockResolvedValue(retained);
    const response = await getReceipt(new Request(`https://keryx.example/api/dispatch/${id}/receipt`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    apiReceipt = await response.json();
  } finally { retained.close(); }
  expect(verifyResearchReceipt(apiReceipt).valid).toBe(true);
  expect(apiReceipt.payload.settlement).toMatchObject({ status: "pending", settledCreatorUsdc: 0, pendingCreatorUsdc: .004001 });
  expect(exportsFromCheckedReceipt(apiReceipt)).toEqual(baseline.researchExports);

  const buyerDirectory = path.join(commerceDirectory(), "R24-buyer");
  await createBuyerJournal(buyerDirectory, { schema: "keryx-buyer-intent-v1", request, requirement, authorization, queryId: id });
  const readCalls: { url: string; method: string; hasPayment: boolean }[] = [];
  const http: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    readCalls.push({ url: String(url), method: init?.method ?? "GET", hasPayment: headers.has("payment-signature") });
    return String(url).includes("/receipt") ? Response.json(receipt, { headers: { "x-keryx-receipt-digest": receipt.integrity.digest } }) : Response.json(a2a);
  };
  const cli = await resumeResearch(buyerDirectory, http);
  expect(cli.status).toBe("completed");
  expect(cli.payment.state).toBe("unconfirmed");
  const savedReceipt = JSON.parse(fs.readFileSync(path.join(buyerDirectory, "receiptFile" in cli ? String(cli.receiptFile) : "missing"), "utf8"));
  expect(exportsFromCheckedReceipt(savedReceipt)).toEqual(baseline.researchExports);

  const stdioJournal = path.join(commerceDirectory(), "R24-stdio.json");
  fs.writeFileSync(stdioJournal, JSON.stringify({ schema: "keryx-mcp-payment-v2", network: SYNTHETIC_NETWORK,
    origin: "https://keryx.cc", queryId: id, authorizationId: authorization.nonce, amountUsdc: "0.05", status: "unconfirmed" }));
  // The independently packaged stdio project owns its TypeScript config and .mts imports.
  // Exercise its real runtime module without adding that package to the web tsc graph.
  const stdioModulePath = "../../mcp/local-payment.mts";
  const { recoverResearch } = await import(stdioModulePath) as {
    recoverResearch: (origin: string, file: string, http: typeof fetch) => Promise<{
      data: typeof a2a | null; payment: { status: string }; httpStatus: number }>
  };
  const stdio = await recoverResearch("https://keryx.cc", stdioJournal, http);
  expect(stdio.data?.researchExports).toEqual(baseline.researchExports);
  expect(stdio.payment.status).toBe("unconfirmed");
  expect(readCalls.every(call => call.method === "GET" && !call.hasPayment)).toBe(true);

  const report = researchReportMarkdown(run, null, [pending]);
  expect(report).toContain(asset.contentVersion);
  expect(report).toContain("abstract-page");
  expect(report).toContain("pending");
  const exportPath = path.join(commerceDirectory(), "R24-desktop-evidence.csv");
  expect(await savePrivateExport(async () => ({ canceled: false, filePath: exportPath }), baseline.researchExports.evidenceCsv)).toBe(true);
  expect(fs.readFileSync(exportPath, "utf8")).toBe(baseline.researchExports.evidenceCsv);

  const extension = await replayExtensionPopup([{ keryx: keryxMeta(run) }], (document, requests) => ({
    status: document.getElementById("status")!.textContent,
    handoff: (document.getElementById("dispatch-link") as HTMLAnchorElement).href,
    inMemorySseRequests: requests, actualHttpRequests: 0,
  }));
  expect(extension.status).toContain("planned rewards are not settlement proof");
  expect(extension.handoff).toContain(`/dispatch/${id}`);
  const telegram = buildAnswerText(run), discord = buildAnswerMessage(run);
  expect(telegram).toContain(`/dispatch/${id}`);
  expect(discord.embeds[0].url).toContain(`/dispatch/${id}`);
  expect(telegram).toContain("planned rewards");
  expect(networkCalls).toBe(0);
  record("R24", criteria.get("R24")!, { sourceIdentity: asset, projected, apiReceipt, cli, stdio, readCalls, extension, telegram, discord,
    surfaceRoles: { web: "shared report/export read model", api: "actual receipt route with isolated retained run", remoteMcp: "result mapper",
      stdioMcp: "original journal GET recovery helper, package installation not launched", cli: "original journal GET recovery and archived receipt",
      desktop: "shared export writer/native save adapter; shell not launched", extension: "actual popup ES module and formatter in DOM; in-memory SSE only; dispatch handoff",
      bots: "actual Telegram/Discord result formatters; dispatch handoff" } },
  ["Real browser and desktop shell", "installed MCP/extension package", "authenticated live recovery", "remote MCP HTTP transport", "actual bot message delivery"]);
});

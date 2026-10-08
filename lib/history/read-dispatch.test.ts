import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PaymentRecord, QueryRun } from "../types";
import type { TestnetArchiveInfo } from "./testnet-archive";
import type { DispatchReader } from "./read-dispatch";
import { verifyResearchReceipt } from "../research-receipt";
import { syntheticFailedOriginal, syntheticFulfilledRun } from "../db/a2a-fulfillment-fixture";

const mocks = vi.hoisted(() => ({ current: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.current }));
vi.mock("./testnet-archive", () => ({ getTestnetArchive: mocks.archive }));
vi.mock("@/lib/arc-network-display", async importOriginal => ({
  ...await importOriginal<typeof import("../arc-network-display")>(), currentArcLabel: "Arc mainnet",
}));
vi.mock("@/lib/answers-archive-cache", () => ({ getArchiveCached: async () => [] }));
vi.mock("@/components/keryx/follow-up-form", () => ({ FollowUpForm: () => null }));

import { loadDispatchThread, resolveDispatch } from "./read-dispatch";
import { GET as readPublicDispatch } from "@/app/api/dispatch/[id]/route";
import { GET as readReceipt } from "@/app/api/dispatch/[id]/receipt/route";
import { GET as readFreshness } from "@/app/api/dispatch/[id]/freshness/route";
import DispatchPage, { generateMetadata } from "@/app/dispatch/[id]/page";
import { DispatchView } from "@/app/dispatch/[id]/dispatch-view";
import { HistoricalDispatchNote } from "@/components/keryx/historical-dispatch-note";

const info: TestnetArchiveInfo = {
  network: "eip155:5042002", label: "Arc testnet", capturedAt: "2026-10-02T12:00:00.000Z",
  sourceCommit: "a".repeat(40), databaseSha256: "b".repeat(64),
};
function run(id = "old-dispatch"): QueryRun {
  return { id, question: "Which question was retained?", budget: 0.05, engine: "llm:historical",
    subClaims: [], decisions: [], citations: [], answer: "Original historical answer", trace: [],
    createdAt: "2026-09-01T00:00:00.000Z", totalSpent: 0, totalToCreators: 0,
    paymentMode: "real", settledPayments: 0, pendingPayments: 0 };
}
function reader(runs: QueryRun[] = [], payments: PaymentRecord[] = []) {
  return {
    getQueryRun: vi.fn(async (id: string) => runs.find(run => run.id === id) ?? null),
    listFollowUps: vi.fn(async (id: string) => runs.filter(run => run.parentId === id)),
    listPaymentsByQuery: vi.fn(async (id: string) => payments.filter(row => row.queryId === id && row.kind === "citation")),
    listCreatorPaymentAttemptsByQuery: vi.fn(async (id: string) => payments.filter(row => row.queryId === id)),
  } satisfies DispatchReader;
}
const params = (id = "old-dispatch") => ({ params: Promise.resolve({ id }) });
const request = (id = "old-dispatch", suffix = "") => new NextRequest(`https://keryx.test/api/dispatch/${id}${suffix}`);
function installArchive(runs = [run()], payments: PaymentRecord[] = []) {
  const store = { ...reader(runs, payments), info };
  mocks.archive.mockResolvedValue(store);
  return store;
}

beforeEach(() => {
  mocks.current.mockReset(); mocks.archive.mockReset();
  mocks.current.mockResolvedValue(reader()); mocks.archive.mockResolvedValue(null);
});

describe("original-network dispatch resolution", () => {
  it("uses the current record and matching reader without opening the archive", async () => {
    const current = reader([{ ...run(), answer: "Current mainnet record" }]);
    installArchive(); mocks.current.mockResolvedValue(current);
    const resolved = await resolveDispatch("old-dispatch");
    expect(resolved?.run.answer).toBe("Current mainnet record");
    expect(resolved?.reader).toBe(current); expect(resolved?.archive).toBeNull();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("does not turn unavailable live storage into historical success", async () => {
    const current = reader(); current.getQueryRun.mockRejectedValue(new Error("current read unavailable"));
    installArchive();
    await expect(resolveDispatch("old-dispatch", current)).rejects.toThrow("current read unavailable");
    expect(mocks.archive).not.toHaveBeenCalled();
    mocks.current.mockRejectedValue(new Error("current initialization unavailable"));
    await expect(resolveDispatch("old-dispatch")).rejects.toThrow("current initialization unavailable");
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("distinguishes missing records, disabled history and unavailable archive", async () => {
    await expect(resolveDispatch("missing")).resolves.toBeNull();
    installArchive(); await expect(resolveDispatch("missing")).resolves.toBeNull();
    mocks.archive.mockRejectedValue(new Error("archive verification unavailable"));
    await expect(resolveDispatch("old-dispatch")).rejects.toThrow("archive verification unavailable");
    expect((await readReceipt(request("old-dispatch", "/receipt"), params())).status).toBe(503);
  });

  it("retains a historical parent in its original reader and adds labeled current follow-ups", async () => {
    const original = { ...run(), parentId: "parent" }, parent = run("parent");
    const child = { ...run("child"), parentId: original.id }, replaced = { ...run("duplicate"), parentId: original.id };
    const historical = installArchive([original, parent, child, replaced]);
    const currentChild = { ...replaced, answer: "Current duplicate wins" };
    const current = reader([{ ...parent, answer: "Conflicting current parent" }, currentChild]);
    const resolved = (await resolveDispatch(original.id, current))!;
    const thread = await loadDispatchThread(resolved, current);
    expect(thread.parent?.run.answer).toBe(parent.answer);
    expect(thread.parent?.reader).toBe(historical);
    expect(thread.followUps.map(row => [row.run.id, row.archive?.network ?? "current"])).toEqual([
      ["child", info.network], ["duplicate", "current"],
    ]);
    expect(thread.followUps[1].run.answer).toBe("Current duplicate wins");
  });

  it("resolves an intentional current follow-up's historical question without borrowing its payment reader", async () => {
    const parent = run("parent"), child = { ...run("current-child"), parentId: parent.id };
    const historical = installArchive([parent]); const current = reader([child]);
    const resolved = (await resolveDispatch(child.id, current))!;
    const thread = await loadDispatchThread(resolved, current);
    expect(resolved.reader).toBe(current); expect(resolved.archive).toBeNull();
    expect(thread.parent?.reader).toBe(historical); expect(thread.parent?.archive).toEqual(info);
  });

  it("keeps a completed current child visible when its historical parent archive is unavailable", async () => {
    const child = { ...run("current-child"), parentId: "old-parent" };
    const current = reader([child]); mocks.current.mockResolvedValue(current);
    mocks.archive.mockRejectedValue(new Error("archive unavailable"));
    const resolved = (await resolveDispatch(child.id, current))!;
    const thread = await loadDispatchThread(resolved, current);
    expect(thread.parent).toBeNull(); expect(thread.parentUnavailable).toBe(true);
    const html = renderToStaticMarkup(await DispatchPage(params(child.id)));
    expect(html).toContain(child.answer); expect(html).toContain("earlier dispatch could not be loaded");
  });

  it("retains the historical answer/thread when current follow-up enrichment fails", async () => {
    const original = run(), child = { ...run("retained-child"), parentId: original.id };
    installArchive([original, child]);
    const current = reader(); current.listFollowUps.mockRejectedValue(new Error("current enrichment unavailable"));
    const resolved = (await resolveDispatch(original.id, current))!;
    const thread = await loadDispatchThread(resolved, current);
    expect(thread.followUps.map(row => row.run.id)).toEqual([child.id]);
    expect(thread.followUpsUnavailable).toBe(true);
    mocks.current.mockResolvedValue(current);
    const html = renderToStaticMarkup(await DispatchPage(params()));
    expect(html).toContain(original.answer); expect(html).toContain("follow-up links could not be loaded");
  });

  it("keeps the completed answer when the optional same-network parent payment comparison is unavailable", async () => {
    const parent = run("parent"), child = { ...run("current-child"), parentId: parent.id, answer: "Current completed answer" };
    const current = reader([parent, child]);
    current.listCreatorPaymentAttemptsByQuery.mockImplementation(async id => {
      if (id === parent.id) throw new Error("parent payment history unavailable");
      return [];
    });
    mocks.current.mockResolvedValue(current);
    const html = renderToStaticMarkup(await DispatchPage(params(child.id)));
    expect(html).toContain(child.answer); expect(html).toContain("earlier payment comparison could not be loaded");
  });
});

describe("historical public read contracts", () => {
  it("keeps the existing canonical permalink and labels its search/share metadata", async () => {
    installArchive();
    const metadata = await generateMetadata(params());
    expect(metadata.alternates?.canonical).toBe("/dispatch/old-dispatch");
    expect(metadata.description).toContain("Arc testnet historical");
    expect(metadata.openGraph?.description).toContain("Arc testnet historical");
  });

  it("renders the original answer with a clear frozen testnet notice and no live feedback controls", () => {
    const historical = renderToStaticMarkup(createElement(Fragment, null,
      createElement(HistoricalDispatchNote, { archive: info }),
      createElement(DispatchView, { run: run(), payments: [], historical: true, historicalNetwork: info.network })));
    expect(historical).toContain("Arc testnet · Historical dispatch");
    expect(historical).toContain("Original historical answer");
    expect(historical).toContain("frozen at that cutoff");
    expect(historical).not.toContain('aria-label="Report feedback"');
    expect(historical).toContain("Arc Testnet · historical");
    expect(historical).not.toContain("live on Arc mainnet");
    const current = renderToStaticMarkup(createElement(DispatchView, { run: run(), payments: [] }));
    expect(current).toContain('aria-label="Report feedback"');
    expect(current).toContain("live on Arc mainnet");
  });

  it("shows original settled testnet evidence with a neutral legacy-mode badge instead of calling it simulated", () => {
    const original = { ...run(), paymentMode: undefined };
    const payment: PaymentRecord = { kind: "citation", queryId: original.id, sourceId: "source", sourceName: "Source",
      payer: `0x${"1".repeat(40)}`, payee: `0x${"2".repeat(40)}`, amountUsdc: 0.002, network: info.network,
      settled: true, settlementStatus: "settled", txHash: "original-circle-transfer", createdAt: original.createdAt };
    const html = renderToStaticMarkup(createElement(DispatchView, {
      run: original, payments: [payment], historical: true, historicalNetwork: info.network,
    }));
    expect(html).toContain("Arc Testnet · historical");
    expect(html).toContain("Gateway · Arc Testnet");
    expect(html).toContain("testnet.arcscan.app/address/");
    expect(html).not.toContain("live on Arc mainnet"); expect(html).not.toContain("simulated");
    expect(original.paymentMode).toBeUndefined(); expect(original.answer).toBe("Original historical answer");
  });

  it("keeps private fulfillment authority out of JSON while preserving original stored evidence", async () => {
    const fixture = syntheticFailedOriginal();
    const original = syntheticFulfilledRun({ ...fixture.input, failedOrder: fixture.order }).run;
    installArchive([original]);
    const response = await readPublicDispatch(request(original.id), params(original.id));
    const publicRun = await response.json();
    expect(publicRun.answer).toBe(original.answer); expect(publicRun.archive).toEqual(info);
    expect(publicRun.originalFulfillment).toBeUndefined(); expect(original.originalFulfillment).toBeDefined();
    expect(JSON.stringify(publicRun)).not.toContain(original.originalFulfillment!.authoritySha256);
    expect(response.headers.get("x-keryx-archive-network")).toBe(info.network);
  });

  it("builds the receipt from archived access and citation attempts with their exact statuses/network", async () => {
    const original = { ...run("a2a_original"), settledPayments: 1, pendingPayments: 1, totalSpent: 0.002, totalToCreators: 0.002 };
    const access: PaymentRecord = { id: "fetch", kind: "fetch", queryId: original.id, sourceId: "source", sourceName: "Source",
      payer: `0x${"1".repeat(40)}`, payee: `0x${"2".repeat(40)}`, amountUsdc: 0.002, network: info.network,
      settled: true, settlementStatus: "settled", txHash: "original-circle-transfer", createdAt: original.createdAt };
    const citation: PaymentRecord = { ...access, id: "citation", kind: "citation", amountUsdc: 0.01,
      settled: false, settlementStatus: "pending", txHash: null };
    installArchive([original], [access, citation]);
    const current = { ...reader(), getA2aOrder: vi.fn(() => { throw new Error("must not use current funding"); }) };
    mocks.current.mockResolvedValue(current);
    const response = await readReceipt(request(original.id, "/receipt"), params(original.id));
    const receipt = await response.json();
    expect(response.status).toBe(200); expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(receipt.payload.settlement).toMatchObject({ status: "pending", settledAccessUsdc: 0.002,
      pendingCreatorUsdc: 0.01, ledgerCompleteness: "complete" });
    expect(receipt.payload.settlement.creatorPayments.map((payment: PaymentRecord) => payment.network)).toEqual([info.network, info.network]);
    expect(current.listCreatorPaymentAttemptsByQuery).not.toHaveBeenCalled();
    expect(current.getA2aOrder).not.toHaveBeenCalled();
    expect(response.headers.get("x-keryx-archive-network")).toBe(info.network);
  });

  it("labels zero-payment history in headers without changing the v1 receipt envelope or digest", async () => {
    installArchive();
    const response = await readReceipt(request("old-dispatch", "/receipt?download=1"), params());
    const receipt = await response.json();
    expect(Object.keys(receipt).sort()).toEqual(["integrity", "payload"]);
    expect(receipt.payload.settlement.creatorPayments).toEqual([]);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(response.headers.get("x-keryx-receipt-digest")).toBe(receipt.integrity.digest);
    expect(response.headers.get("x-keryx-archive-captured-at")).toBe(info.capturedAt);
    expect(response.headers.get("content-disposition")).toContain("keryx-receipt-old-dispatch.json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports frozen historical freshness without reading current sources or inventing a check timestamp", async () => {
    installArchive();
    const current = { ...reader(), getSource: vi.fn(), listSources: vi.fn(), newestItemDates: vi.fn() };
    mocks.current.mockResolvedValue(current);
    const response = await readFreshness(request("old-dispatch", "/freshness"), params());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ queryId: "old-dispatch", archive: info,
      checkedAt: null, freshness: null, status: "historical" });
    expect(current.getSource).not.toHaveBeenCalled(); expect(current.listSources).not.toHaveBeenCalled();
    expect(current.newestItemDates).not.toHaveBeenCalled();
  });
});

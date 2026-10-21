// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperatorLedgerView } from "../../components/keryx/operator-ledger-view";
import { createMessages } from "../i18n/messages";
import { downloadBrowserText } from "../browser-text-download";
import { fetchOperatorLedger } from "./client";
import type { OperatorLedger } from "./contracts";
import { ledgerDigest } from "./projection";
import { operatorLedgerCsv, verifyOperatorLedger } from "./export";
import { ledgerFixture, ledgerPayment } from "./test-fixture";

vi.mock("./client", () => ({ fetchOperatorLedger: vi.fn() }));
vi.mock("../browser-text-download", () => ({ downloadBrowserText: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));

const message = createMessages("en"), fetcher = vi.mocked(fetchOperatorLedger);
let root: Root, container: HTMLDivElement;
type Read = { days: number; signal: AbortSignal; promise: Promise<OperatorLedger>;
  resolve(value: OperatorLedger): void; reject(reason: Error): void };
let reads: Read[];
function snapshot(days: number) {
  const ledger = ledgerFixture(undefined, [ledgerPayment({ amountUsdc: days === 7 ? 0.007001 : 0.031001 })]);
  ledger.payload.window.days = days;
  ledger.payload.window.from = new Date(Date.parse(ledger.payload.window.readStartedAt) - days * 86_400_000).toISOString();
  ledger.integrity.digest = ledgerDigest(ledger.payload);
  return ledger;
}
function changeDays(days: number) {
  const select = container.querySelector<HTMLSelectElement>("#ledger-days")!;
  select.value = String(days); select.dispatchEvent(new Event("change", { bubbles: true }));
}
function retry() { container.querySelector<HTMLButtonElement>("button")!.click(); }
function exports() { return [...container.querySelectorAll<HTMLButtonElement>("button")].filter(button =>
  [message("jobLedger.exportJson"), message("jobLedger.exportCsv")].includes(button.textContent ?? "")); }
async function download(index: number) { await act(async () => { exports()[index].click(); }); }
function loading() {
  expect(container.querySelector('[role="status"]')?.textContent).toBe(message("jobLedger.loading"));
  expect(exports()).toEqual([]);
  expect(container.textContent).not.toContain("0.007001 USDC");
}
beforeEach(async () => {
  reads = []; fetcher.mockReset(); vi.mocked(downloadBrowserText).mockClear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher.mockImplementation((_origin, days = 7, signal) => {
    let resolve!: Read["resolve"], reject!: Read["reject"];
    const promise = new Promise<OperatorLedger>((yes, no) => { resolve = yes; reject = no; });
    // Deliberately ignore abort at the transport edge: the view owns its lifecycle.
    reads.push({ days, signal: signal!, promise, resolve, reject }); return promise;
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(OperatorLedgerView)); });
  expect(reads.map(read => read.days)).toEqual([7]);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals();
});

it("downloads the displayed verified snapshot in both formats without another read", async () => {
  loading(); await act(async () => { reads[0].resolve(snapshot(7)); });
  expect(container.textContent).toContain("0.007001 USDC");
  expect(exports()).toHaveLength(2); await download(0); await download(1);
  const calls = vi.mocked(downloadBrowserText).mock.calls;
  expect(verifyOperatorLedger(JSON.parse(calls[0][0]), snapshot(7).integrity.digest)).toEqual(snapshot(7));
  expect(calls[1][0]).toBe(operatorLedgerCsv(snapshot(7)));
  expect(calls.map(call => call[1])).toEqual(["keryx-public-job-ledger.json", "keryx-public-job-ledger.csv"]);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("cannot pair a newly selected period with a response completing in the same React batch", async () => {
  await act(async () => {
    changeDays(31); reads[0].resolve(snapshot(7)); await reads[0].promise;
  });
  expect(reads.map(read => read.days)).toEqual([7, 31]);
  expect(reads[0].signal.aborted).toBe(true); loading();
  await act(async () => { reads[1].resolve(snapshot(31)); });
  expect(container.textContent).toContain("0.031001 USDC");
  expect(container.textContent).not.toContain("0.007001 USDC");
  await download(0);
  expect(verifyOperatorLedger(JSON.parse(vi.mocked(downloadBrowserText).mock.calls[0][0]), snapshot(31).integrity.digest)).toEqual(snapshot(31));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not treat a response from before Read again as the new observation", async () => {
  await act(async () => { retry(); reads[0].resolve(snapshot(7)); await reads[0].promise; });
  expect(reads.map(read => read.days)).toEqual([7, 7]); loading();
  await act(async () => { reads[1].resolve(snapshot(7)); });
  expect(container.textContent).toContain("0.007001 USDC");
});

it("does not show an old failure as the newly selected period's failure", async () => {
  await act(async () => { changeDays(31); reads[0].reject(new Error("Old read failed")); await Promise.resolve(); });
  loading();
  await act(async () => { reads[1].resolve(snapshot(31)); });
  expect(container.textContent).toContain("0.031001 USDC");
});

it("ignores an old success after the new observation has finished", async () => {
  await act(async () => { changeDays(31); });
  await act(async () => { reads[1].resolve(snapshot(31)); });
  await act(async () => { reads[0].resolve(snapshot(7)); });
  expect(container.textContent).toContain("0.031001 USDC");
  expect(container.textContent).not.toContain("0.007001 USDC");
  await download(0);
  expect(JSON.parse(vi.mocked(downloadBrowserText).mock.calls[0][0]).payload.window.days).toBe(31);
});

it("clears a completed observation on period change and recovers from a current read failure", async () => {
  await act(async () => { reads[0].resolve(snapshot(7)); });
  await act(async () => { changeDays(31); }); loading();
  await act(async () => { reads[1].reject(new Error("Current read failed")); });
  expect(container.querySelector('[role="status"]')?.textContent).toBe(message("jobLedger.unavailable"));
  expect(exports()).toEqual([]);
  await act(async () => { retry(); }); loading();
  expect(reads.map(read => read.days)).toEqual([7, 31, 31]);
  await act(async () => { reads[2].resolve(snapshot(31)); });
  expect(container.textContent).toContain("0.031001 USDC");
});

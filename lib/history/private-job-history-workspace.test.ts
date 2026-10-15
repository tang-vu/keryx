// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { PrivateJobHistoryWorkspace } from "@/components/keryx/private-job-history-workspace";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, PRIVATE_JOB_HISTORY_QUALIFICATION, privateJobHistoryCapabilities,
  type PrivateJobHistoryRow, type PrivateJobHistoryPage, type PrivateJobHistoryDetail, type PrivateJobHistoryExport } from "./private-job-history-contract";

// Actual workspace/stream reader/shared schemas; only auth and HTTP are synthetic.
// These tests prove no actual session, store, paid-result delivery or financial acceptance.
const auth = vi.hoisted(() => ({ session: undefined as { address: string; role: string } | null | undefined,
  address: undefined as string | undefined, isConnected: false, authState: "idle", refresh: vi.fn(async () => null) }));
vi.mock("@/lib/hooks/use-siwe-auth", () => ({ useSiweAuth: () => auth }));
vi.mock("next/link", () => ({ default: ({ prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => React.createElement("a", props) }));

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const id = (digit = "1") => `prv_${digit.repeat(64)}`;
const date = "2026-10-14T00:00:00.123456+00:00";
const row = (wallet = alice, digit = "1"): PrivateJobHistoryRow => ({
  id: id(digit), ownerWallet: wallet, createdAt: date, intentCreatedAt: date, savedAt: date,
  question: `PRIVATE ${wallet === alice ? "ALICE" : "BOB"} QUESTION ${digit}`, researchMode: "deep", model: null,
  packageVersion: "1.0.0", record: "finalized-private-result", provenance: null,
  incomingSettlement: { status: "settled", amountMicros: "120000", network: "eip155:5042", reference: "incoming-only",
    settledAt: date, evidenceSource: "circle-facilitator-success", chainFinalityVerified: false },
  ownSettledSpendMicros: null, creatorRewardsMicros: null, paidCreators: null,
});
const envelope = (wallet = alice) => ({ format: "private-job-history-v1" as const, wallet,
  scope: "exact-payer-private-current-store" as const, capabilities: privateJobHistoryCapabilities,
  qualification: PRIVATE_JOB_HISTORY_QUALIFICATION } as const);
const page = (rows = [row()], nextCursor: string | null = null): PrivateJobHistoryPage => ({ ...envelope(rows[0]?.ownerWallet ?? alice), rows,
  nextCursor, scanLimited: false, scannedIntents: rows.length });
const detail = (saved = row()): PrivateJobHistoryDetail => ({ ...envelope(saved.ownerWallet), row: { ...saved, intentCreatedAt: null },
  result: { answer: "PRIVATE SAVED ANSWER <script>window.paidAction()</script> https://example.test/private",
    engine: "recorded-engine", createdAt: saved.createdAt, savedAt: saved.savedAt, subClaims: ["Recorded claim"],
    decisions: [{ sourceId: "source", sourceName: "Recorded source", action: "BUY", rationale: "Saved decision only", price: 0.01,
      expectedValue: 0.5, confidence: 0.5, targets: [0] }],
    citations: [{ marker: "[1]", sourceId: "source", sourceName: "Recorded source", weight: 1, recordedRewardUsdc: 0.02, rationale: "Saved attribution only" }],
    evidence: null, claimCoverage: null, paymentEvidence: "incoming-only-no-creator-ledger" } });
const exported = (rows = [row()], truncated = false): PrivateJobHistoryExport => ({ ...envelope(rows[0]?.ownerWallet ?? alice), rows,
  nextCursor: truncated ? "cursor_next" : null, complete: !truncated, truncated, pages: 1,
  bounds: { maxPages: 20, maxRows: 500, maxBytes: 2 * 1024 * 1024 } });
const session = (address = alice) => ({ address, role: "asker" });
let root: Root | undefined, container: HTMLDivElement;

function deferred() {
  let resolve!: (value: Response) => void;
  return { promise: new Promise<Response>(done => { resolve = done; }), resolve: (value: Response) => resolve(value) };
}
function fixture() {
  let respond: (path: string, init: RequestInit) => Response | Promise<Response> = path => Response.json(
    path.endsWith("/detail") ? detail() : path.endsWith("/export") ? exported() : page());
  const fetcher = vi.fn<typeof fetch>(async (path, init = {}) => {
    if (!["/api/me/private-jobs", "/api/me/private-jobs/detail", "/api/me/private-jobs/export"].includes(String(path))) throw new Error("Unexpected request");
    return respond(String(path), init);
  });
  vi.stubGlobal("fetch", fetcher);
  const blobs: Blob[] = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:private-download"; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const downloads: { href: string; name: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ href: this.href, name: this.download }); });
  return { fetcher, blobs, downloads, respond: (handler: typeof respond) => { respond = handler; } };
}
async function render(nextSession = auth.session) {
  auth.session = nextSession;
  await act(async () => { root ??= createRoot(container); root.render(React.createElement(PrivateJobHistoryWorkspace)); });
}
function button(label: string) {
  const element = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  expect(element, label).toBeTruthy(); return element!;
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function event(name: string) { await act(async () => { window.dispatchEvent(new Event(name)); }); }
async function change(label: string, value: string) {
  const field = [...container.querySelectorAll("label")].find(element => element.textContent?.startsWith(label))?.querySelector("input,select");
  expect(field).toBeTruthy();
  await act(async () => {
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field!.dispatchEvent(new Event(field instanceof HTMLInputElement ? "input" : "change", { bubbles: true }));
  });
}
const body = (init?: RequestInit) => JSON.parse(String(init?.body));
async function blobText(blob: Blob) {
  // jsdom Blob does not implement text() in every installed version.
  return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  auth.session = session(); auth.address = undefined; auth.isConnected = false; auth.authState = "idle"; auth.refresh.mockClear();
  vi.stubGlobal("BroadcastChannel", class { onmessage: (() => void) | null = null; close() {} });
  container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(URL, "createObjectURL"); Reflect.deleteProperty(URL, "revokeObjectURL");
});

it.each([undefined, null])("has no private DOM or data request while checking/signed out (%s)", async value => {
  const f = fixture(); auth.session = value; auth.address = alice; auth.isConnected = true; await render();
  expect(f.fetcher).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("PRIVATE ALICE");
  expect(container.querySelector("form")).toBeNull();
  if (value === null) expect(container.querySelector("a")?.getAttribute("href")).toBe("/connect");
});

it("server prerender contains only checking copy even with a synthetic preexisting session", () => {
  const f = fixture(); const html = renderToString(React.createElement(PrivateJobHistoryWorkspace));
  expect(html).toContain("Checking your sign-in"); expect(html).not.toContain(alice);
  expect(html).not.toContain("PRIVATE"); expect(html).not.toContain("<form"); expect(f.fetcher).not.toHaveBeenCalled();
});

it("uses cookie POST, fixed paths, exact expected-wallet precondition and honest NULL economics", async () => {
  const f = fixture(); await render();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.fetcher.mock.calls[0][0]).toBe("/api/me/private-jobs");
  const init = f.fetcher.mock.calls[0][1]!;
  expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
  expect(new Headers(init.headers).get("authorization")).toBeNull();
  expect(new Headers(init.headers).get("x-keryx-expected-wallet")).toBe(alice);
  expect(body(init)).toEqual({ limit: 25 });
  expect(container.textContent).toContain("PRIVATE ALICE QUESTION 1");
  expect(container.textContent).toContain("Settled incoming original price: 0.120000 USDC");
  expect(container.textContent).toContain("Own settled source spend: unavailable (NULL)");
  expect(container.textContent).toContain("Creator rewards: unavailable (NULL)");
  expect(container.textContent).toContain("Paid creators: unavailable (NULL)");
  expect(container.textContent).toContain("Surface: UNKNOWN / legacy");
  expect(container.textContent).toContain("Recorded network: eip155:5042");
  expect(container.textContent).toContain("chain finality independently verified: no");
  expect(container.querySelectorAll("a")).toHaveLength(0);
  expect(localStorage.length).toBe(0); expect(location.search).toBe("");
});

it.each([401, 403, 409, 503, 500])("refuses HTTP %i, never paints its body or retries automatically", async status => {
  const f = fixture(); f.respond(() => Response.json({ private: "FOREIGN SECRET", rows: [] }, { status })); await render();
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(container.textContent).not.toContain("FOREIGN SECRET"); expect(container.textContent).not.toContain("No completed jobs matched");
  expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(f.fetcher).toHaveBeenCalledTimes(1);
  if (status === 401 || status === 403 || status === 409) expect(button("Check sign-in")).toBeTruthy();
});

it("retries a 503 list only after the manual refresh action", async () => {
  const f = fixture(); f.respond(() => Response.json({ error: "history_unavailable" }, { status: 503 })); await render();
  expect(f.fetcher).toHaveBeenCalledTimes(1); f.respond(() => Response.json(page()));
  await click("Refresh history"); expect(f.fetcher).toHaveBeenCalledTimes(2); expect(container.textContent).toContain("PRIVATE ALICE");
});

it.each([
  () => ({ ...page(), format: "private-history-v1" }),
  () => page([row(bob)]),
  () => ({ ...page(), rows: [{ ...row(), ownerWallet: bob }] }),
  () => ({ ...page(), rows: [{ ...row(), ownSettledSpendMicros: "120000" }] }),
  () => ({ ...page(), rows: [{ ...row(), paidCreators: 0 }] }),
  () => ({ ...page(), capabilities: { ...privateJobHistoryCapabilities, multiwallet: true } }),
  () => ({ ...page(), scannedIntents: 0 }),
  () => ({ ...page(), rows: [row(), row()], scannedIntents: 2 }),
  () => ({ ...page(), nextCursor: "private/foreign?wallet=bad" }),
])("rejects malformed/foreign/unsupported completed-page data (%#)", async invalid => {
  const f = fixture(); f.respond(() => Response.json(invalid())); await render();
  expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(container.textContent).not.toContain("PRIVATE BOB");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
  expect(f.downloads).toEqual([]); expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it("preserves explicit empty continuing scans and replaces, bounds and reverses pages", async () => {
  const f = fixture(); f.respond((_path, init) => {
    const cursor = body(init).cursor;
    return Response.json(cursor ? page([{ ...row(alice, "2"), intentCreatedAt: "2026-10-13T00:00:00Z" }])
      : { ...page([], "cursor_one"), scanLimited: true, scannedIntents: 25 });
  });
  await render(); expect(container.textContent).toContain("No completed jobs matched this scanned page");
  expect(container.textContent).toContain("More intents remain"); expect(button("Next page").disabled).toBe(false);
  await click("Next page"); expect(body(f.fetcher.mock.calls[1][1])).toEqual({ limit: 25, cursor: "cursor_one" });
  expect(container.textContent).toContain("Page 2: 1 completed rows"); expect(container.textContent).toContain("PRIVATE ALICE QUESTION 2");
  await click("Previous page"); expect(body(f.fetcher.mock.calls[2][1])).toEqual({ limit: 25 });
  expect(container.textContent).not.toContain("PRIVATE ALICE QUESTION 2"); expect(button("Previous page").disabled).toBe(true);
});

it("sends only applied literal/network/surface/UTC schema filters in bodies and exports the applied query", async () => {
  const f = fixture(); await render();
  await change("Question contains", "ALICE"); await change("Recorded surface", "unknown"); await change("Recorded network", "eip155:5042");
  await change("From UTC", "2026-10-13T00:00:00Z"); await change("To UTC", "2026-10-15T00:00:00Z");
  await click("Apply filters");
  const filters = { limit: 25, search: "ALICE", surface: "unknown", network: "eip155:5042", from: "2026-10-13T00:00:00Z", to: "2026-10-15T00:00:00Z" };
  expect(body(f.fetcher.mock.calls[1][1])).toEqual(filters);
  await change("Question contains", "UNAPPLIED PRIVATE DRAFT"); await click("Download JSON");
  expect(body(f.fetcher.mock.calls[2][1])).toEqual({ ...filters, format: "json" });
  expect(f.downloads[0].name).toBe("keryx-private-job-history.json"); expect(location.search).toBe("");
});

it("invalid UTC/reversed dates refuse locally; schema-valid responses outside applied filters refuse", async () => {
  const f = fixture(); await render();
  await change("From UTC", "2026-10-15T00:00:00Z"); await change("To UTC", "2026-10-13T00:00:00Z"); await click("Apply filters");
  expect(f.fetcher).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="alert"]')?.textContent).toContain("Check the filters");
  await change("From UTC", ""); await change("To UTC", ""); await change("Question contains", "BOB"); await click("Apply filters");
  expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
});

it("keeps descendant control focus usable but fences a genuine window focus before late private detail", async () => {
  const f = fixture(); await render();
  await act(async () => { button("View saved result").focus(); });
  expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
  expect(f.fetcher).toHaveBeenCalledTimes(1); expect(auth.refresh).not.toHaveBeenCalled();
  const old = deferred(); f.respond(() => old.promise);
  await click("View saved result");
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(f.fetcher.mock.calls[1][0]).toBe("/api/me/private-jobs/detail");
  const signal = f.fetcher.mock.calls[1][1]!.signal!;
  expect(signal.aborted).toBe(false);
  await act(async () => { container.querySelector("input")!.focus(); });
  expect(signal.aborted).toBe(false); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
  await event("focus");
  expect(signal.aborted).toBe(true); expect(container.querySelector("form")).toBeNull();
  await act(async () => { old.resolve(Response.json(detail())); });
  expect(container.textContent).not.toContain("PRIVATE ALICE");
  expect(container.textContent).not.toContain("PRIVATE SAVED ANSWER");
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  await render(auth.session); expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it.each(["keryx:auth", "focus"])("immediately aborts/wipes %s, suppresses a late old response and waits for fresh same-wallet verification", async name => {
  const f = fixture(), old = deferred(); f.respond(() => old.promise); await render();
  const oldSignal = f.fetcher.mock.calls[0][1]!.signal!;
  await event(name); expect(oldSignal.aborted).toBe(true); expect(container.querySelector("form")).toBeNull();
  await act(async () => { old.resolve(Response.json(page())); });
  expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(f.fetcher).toHaveBeenCalledTimes(1);
  await render(auth.session); expect(f.fetcher).toHaveBeenCalledTimes(1); // Same stale object cannot reopen.
  f.respond(() => Response.json(page())); await render(session());
  expect(f.fetcher).toHaveBeenCalledTimes(2); expect(container.textContent).toContain("PRIVATE ALICE");
});

it("same-wallet session replacement remounts and clears saved detail, filters and download state", async () => {
  const f = fixture(); await render(); await click("View saved result"); expect(container.textContent).toContain("PRIVATE SAVED ANSWER");
  await change("Question contains", "PRIVATE ALICE DRAFT"); await click("Download JSON");
  expect(container.textContent).toContain("Downloaded"); expect(container.textContent).toContain("PRIVATE SAVED ANSWER");
  f.respond(() => Response.json(page([]))); await render(session());
  expect(container.textContent).not.toContain("PRIVATE ALICE QUESTION"); expect(container.textContent).not.toContain("PRIVATE SAVED ANSWER");
  expect(container.textContent).not.toContain("Downloaded"); expect(container.querySelector("input")?.value).toBe("");
});

it.each(["same-wallet", "owner", "logout", "unmount"])("does not publish late private list/detail/export after %s", async transition => {
  for (const action of ["list", "detail", "export"] as const) {
    const f = fixture(), pending = deferred();
    if (action === "list") f.respond(() => pending.promise);
    await render(session());
    if (action !== "list") {
      f.respond(() => pending.promise); await click(action === "detail" ? "View saved result" : "Download JSON");
    }
    const oldSignal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
    f.respond(() => Response.json(transition === "same-wallet" ? page([]) : page([row(bob)])));
    if (transition === "unmount") await act(async () => { root!.unmount(); root = undefined; });
    else await render(transition === "logout" ? null : session(transition === "same-wallet" ? alice : bob));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { pending.resolve(Response.json(action === "list" ? page() : action === "detail" ? detail() : exported())); });
    expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(container.textContent).not.toContain("PRIVATE SAVED ANSWER"); expect(f.downloads).toEqual([]);
    if (root) await act(async () => { root!.unmount(); root = undefined; });
  }
});

it("connector changes cannot authenticate; signing/signout revisions purge until a fresh verified session", async () => {
  const f = fixture(); await render();
  auth.address = bob; auth.isConnected = true; await render(); expect(container.querySelector("form")).toBeNull();
  expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(f.fetcher).toHaveBeenCalledTimes(1);
  auth.address = alice; await render(); expect(f.fetcher).toHaveBeenCalledTimes(1);
  await render(session()); expect(container.textContent).toContain("PRIVATE ALICE");
  auth.authState = "signing-out"; await render(); expect(container.querySelector("form")).toBeNull();
  auth.authState = "idle"; await render(); expect(container.querySelector("form")).toBeNull();
  await click("Check sign-in"); expect(auth.refresh).toHaveBeenCalledTimes(1);
  await render(session()); expect(container.textContent).toContain("PRIVATE ALICE");
});

it("cross-tab auth invalidation clears private DOM and aborts pending IO", async () => {
  let channel: { onmessage: (() => void) | null } | undefined;
  vi.stubGlobal("BroadcastChannel", class { onmessage: (() => void) | null = null; constructor() { channel = this; } close() {} });
  const f = fixture(); await render(); const pending = deferred(); f.respond(() => pending.promise); await click("Refresh history");
  await act(async () => { channel!.onmessage!(); });
  expect(f.fetcher.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true); expect(container.querySelector("form")).toBeNull();
  await act(async () => { pending.resolve(Response.json(page())); }); expect(container.textContent).not.toContain("PRIVATE ALICE");
});

it("renders only escaped saved result text and historical attribution, with no href/script/paid action", async () => {
  const f = fixture(); await render(); await click("View saved result");
  expect(body(f.fetcher.mock.calls[1][1])).toEqual({ id: id() }); expect(f.fetcher.mock.calls[1][0]).toBe("/api/me/private-jobs/detail");
  expect(container.querySelector("pre")?.textContent).toBe(detail().result.answer);
  expect(container.querySelectorAll("script,a")).toHaveLength(0);
  expect(container.textContent).toContain("Recorded reward attribution: 0.02 USDC (settlement unavailable)");
  expect(container.textContent).toContain("Recorded offer price: 0.01 USDC; this is not settled own spend");
  expect(container.textContent).toContain("unavailable in this saved legacy result");
  expect(f.fetcher).toHaveBeenCalledTimes(2); await click("Close result"); expect(container.querySelector("pre")).toBeNull();
});

it("closed/superseded detail cannot erase or overwrite a newer result even when transport ignores abort", async () => {
  const f = fixture(), old = deferred(); await render(); f.respond(() => old.promise); await click("View saved result");
  const signal = f.fetcher.mock.calls[1][1]!.signal!; await click("Close result"); expect(signal.aborted).toBe(true);
  f.respond(() => Response.json({ ...detail(), result: { ...detail().result, answer: "NEW SAVED ANSWER" } }));
  await click("View saved result"); await act(async () => { old.resolve(Response.json(detail())); });
  expect(container.querySelector("pre")?.textContent).toBe("NEW SAVED ANSWER"); expect(container.querySelector('[role="alert"]')).toBeNull();
});

it.each([401, 403, 409, 404, 503])("detail HTTP %i clears private results with truthful refusal", async status => {
  const f = fixture(); await render(); f.respond(() => Response.json(detail(), { status })); await click("View saved result");
  expect(container.querySelector("pre")).toBeNull(); expect(container.textContent).not.toContain("PRIVATE ALICE");
  expect(container.querySelector('[role="alert"]')).toBeTruthy(); expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  () => detail(row(bob)),
  () => detail({ ...row(), id: id("2") }),
  () => detail({ ...row(), incomingSettlement: { ...row().incomingSettlement, amountMicros: "130000" } }),
  () => ({ ...detail(), result: { ...detail().result, paymentEvidence: "creator-ledger" } }),
])("rejects detail owner/selection/schema mismatches (%#)", async invalid => {
  const f = fixture(); await render(); f.respond(() => Response.json(invalid())); await click("View saved result");
  expect(container.querySelector("pre")).toBeNull(); expect(container.querySelector('[role="alert"]')).toBeTruthy();
});

it.each(["json", "csv"] as const)("downloads validated bounded %s metadata only on manual action, with NULL/qualification and immediate URL cleanup", async format => {
  const saved = { ...row(), question: '=HYPERLINK("https://foreign.test","formula")' };
  const f = fixture(); f.respond(path => Response.json(path.endsWith("/export") ? exported([saved], true) : page([saved]))); await render();
  expect(f.downloads).toEqual([]); await click(format === "json" ? "Download JSON" : "Download CSV");
  expect(f.fetcher).toHaveBeenCalledTimes(2); expect(f.fetcher.mock.calls[1][0]).toBe("/api/me/private-jobs/export");
  expect(body(f.fetcher.mock.calls[1][1])).toEqual({ limit: 25, format: "json" });
  const text = await blobText(f.blobs[0]);
  expect(text).toContain("exact-payer-private-current-store"); expect(text).toContain("ownSettledSpendMicros");
  expect(text).toContain("creatorRewardsMicros"); expect(text).toContain("paidCreators");
  expect(text).not.toContain("PRIVATE SAVED ANSWER"); expect(text).not.toContain("signature");
  if (format === "json") expect(JSON.parse(text).rows[0].ownSettledSpendMicros).toBeNull();
  else expect(text).toContain("'=HYPERLINK");
  expect(container.textContent).toContain("Export is truncated"); expect(container.querySelectorAll("a[href^='blob:']")).toHaveLength(0);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-download");
});

it.each([
  () => exported([row(bob)]),
  () => ({ ...exported(), complete: true, truncated: true }),
  () => ({ ...exported(), bounds: { maxPages: 21, maxRows: 500, maxBytes: B.exportBytes } }),
  () => ({ ...exported(), rows: [row(), row()] }),
  () => ({ ...exported(), format: "public-history-v1" }),
])("refuses malformed/foreign exports without creating a download (%#)", async invalid => {
  const f = fixture(); await render(); f.respond(() => Response.json(invalid())); await click("Download JSON");
  expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]); expect(container.querySelector('[role="alert"]')).toBeTruthy();
});

it.each([401, 403, 409, 503])("export HTTP %i clears history and does not download or retry", async status => {
  const f = fixture(); await render(); f.respond(() => Response.json(exported(), { status })); await click("Download CSV");
  expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]); expect(container.textContent).not.toContain("PRIVATE ALICE");
  expect(container.querySelector('[role="alert"]')).toBeTruthy(); expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it.each(["list", "detail", "export"] as const)("times out hung %s transport at its existing bound without automatic retry or late delivery", async action => {
  const f = fixture(); if (action !== "list") await render();
  vi.useFakeTimers(); const pending = deferred(); f.respond(() => pending.promise);
  if (action === "list") await render(); else await click(action === "detail" ? "View saved result" : "Download JSON");
  const count = f.fetcher.mock.calls.length, signal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
  await act(async () => { await vi.advanceTimersByTimeAsync(action === "export" ? B.exportMs : B.readMs); });
  expect(signal.aborted).toBe(true); expect(container.querySelector('[role="alert"]')).toBeTruthy();
  await act(async () => { pending.resolve(Response.json(action === "list" ? page() : action === "detail" ? detail() : exported())); });
  expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(f.downloads).toEqual([]); expect(f.fetcher).toHaveBeenCalledTimes(count);
});

it.each(["list", "detail", "export"] as const)("bounds decoded %s response bytes before parsing or private paint/download", async action => {
  const f = fixture(); if (action !== "list") await render();
  const bound = action === "list" ? B.pageBytes : action === "detail" ? B.detailBytes : B.exportBytes;
  let cancelled = false;
  f.respond(() => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    // Multi-byte decoded body with no Content-Length; compressed/wire size cannot bypass it.
    controller.enqueue(new TextEncoder().encode(`{"padding":"${"é".repeat(Math.ceil(bound / 2))}"}`));
  }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } }));
  if (action === "list") await render(); else await click(action === "detail" ? "View saved result" : "Download JSON");
  expect(container.querySelector('[role="alert"]')).toBeTruthy(); expect(container.querySelector("pre")).toBeNull(); expect(f.downloads).toEqual([]); expect(cancelled).toBe(true);
});

it.each([
  () => new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 0xc3, 0x28, 34, 125]), { headers: { "Content-Type": "application/json" } }),
  () => new Response("{broken", { headers: { "Content-Type": "application/json" } }),
  () => new Response(JSON.stringify(page()), { headers: { "Content-Type": "text/html" } }),
  () => new Response(JSON.stringify(page()), { headers: { "Content-Type": "application/json", "Content-Length": String(B.pageBytes + 1) } }),
])("refuses malformed UTF-8/JSON/MIME/declared byte bounds (%#)", async response => {
  const f = fixture(); f.respond(response); await render(); expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(container.textContent).not.toContain("PRIVATE ALICE"); expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it("aborts a hung streamed body on auth revision and never resumes old parsing", async () => {
  const f = fixture(); let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  f.respond(() => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('{"format":')); } }), { headers: { "Content-Type": "application/json" } }));
  await render(); await event("focus"); expect(f.fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain("PRIVATE ALICE");
  expect(() => stream!.enqueue(new TextEncoder().encode('"private-job-history-v1"}'))).toThrow();
});

it("caps retained navigation at twenty pages and refuses repeated continuation cursors", async () => {
  const f = fixture(); let number = 0;
  f.respond(() => Response.json({ ...page([], `cursor_${++number}`), scannedIntents: 25, scanLimited: true }));
  await render(); for (let index = 1; index < 20; index++) await click("Next page");
  expect(f.fetcher).toHaveBeenCalledTimes(20); expect(button("Next page").disabled).toBe(true);
  expect(container.textContent).toContain("Reached the 20-page navigation bound");
  f.respond((_path, init) => Response.json(page([], body(init).cursor ?? "same_cursor")));
  await click("Refresh history"); await click("Next page"); expect(container.querySelector('[role="alert"]')).toBeTruthy();
});

describe("header logout with TWO actual independent useSiweAuth instances", () => {
  // Unmock auth and Link for this suite. Only wagmi and HTTP are controlled.
  // The header actor calls the real hook; the real workspace mounts another hook.
  let useRealAuth: typeof import("../hooks/use-siwe-auth").useSiweAuth;
  let RealWorkspace: typeof PrivateJobHistoryWorkspace;
  let header: ReturnType<typeof useRealAuth>;
  let headerError: string;
  let confirmations: string[];
  const confirmedLogout = (event: Event) => { if ((event as CustomEvent).detail === "signed-out") confirmations.push("signed-out"); };
  const waitFor = <T,>() => {
    let resolve!: (value: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  };
  function HeaderActor() {
    const hook = useRealAuth(); header = hook;
    const [error, setError] = React.useState("");
    return React.createElement("header", null,
      React.createElement("span", { "data-header-state": true }, `${hook.authState}:${hook.session?.address ?? "cleared"}`),
      React.createElement("button", { onClick: () => { void hook.signOut().catch((error: Error) => {
        headerError = error.message; setError(error.message);
      }); } }, "Header sign out"),
      React.createElement("p", { "data-header-error": true }, error));
  }
  async function mountReal() {
    await act(async () => {
      root ??= createRoot(container);
      root.render(React.createElement(React.Fragment, null, React.createElement(HeaderActor), React.createElement(RealWorkspace)));
    });
  }
  function realHttp() {
    const privateHttp = fixture();
    let lookup: () => Response | Promise<Response> = () => Response.json({ session: session() });
    let logout: (init: RequestInit) => Response | Promise<Response> = () => Response.json({ ok: true });
    const fetcher = vi.fn<typeof fetch>(async (path, init = {}) => {
      if (path === "/api/auth/session") return lookup();
      if (path === "/api/auth/signout") return logout(init);
      return privateHttp.fetcher(path, init);
    });
    vi.stubGlobal("fetch", fetcher);
    return { ...privateHttp, authHttp: fetcher, lookup: (next: typeof lookup) => { lookup = next; }, logout: (next: typeof logout) => { logout = next; } };
  }
  function heldBody(value: unknown) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const part = waitFor<ReadableStreamReadResult<Uint8Array>>();
    let reads = 0;
    const cancel = vi.fn(async () => undefined);
    // HTTP body deliberately ignores cancellation and can release valid old data.
    const reader = { read: () => ++reads === 1 ? Promise.resolve({ done: false, value: bytes.slice(0, 10) })
      : reads === 2 ? part.promise : Promise.resolve({ done: true, value: undefined }), cancel, releaseLock: vi.fn() };
    const response = Response.json(value);
    Object.defineProperty(response, "body", { value: { getReader: () => reader } });
    return { response, cancel, release: () => part.resolve({ done: false, value: bytes.slice(10) }) };
  }
  const cleared = (f: ReturnType<typeof realHttp>) => {
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("PRIVATE ALICE");
    expect(container.textContent).not.toContain("PRIVATE SAVED ANSWER");
    expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]);
    expect(header.session).toBeNull();
  };
  async function freshSession() { await act(async () => { window.dispatchEvent(new Event("focus")); }); }

  beforeEach(async () => {
    vi.unstubAllGlobals(); // Restore native channel/event delivery for the real-hook proof.
    vi.resetModules();
    vi.doUnmock("@/lib/hooks/use-siwe-auth"); vi.doUnmock("next/link");
    vi.doMock("wagmi", () => ({ useAccount: () => ({ address: alice, isConnected: true, connector: { id: "injected" } }),
      useSignMessage: () => ({ signMessageAsync: vi.fn(() => { throw new Error("No signing belongs to this fixture"); }) }) }));
    useRealAuth = (await import("../hooks/use-siwe-auth")).useSiweAuth;
    RealWorkspace = (await import("@/components/keryx/private-job-history-workspace")).PrivateJobHistoryWorkspace;
    headerError = ""; confirmations = []; window.addEventListener("keryx:auth", confirmedLogout);
  });
  afterEach(() => { window.removeEventListener("keryx:auth", confirmedLogout); vi.doUnmock("wagmi"); });

  it("keeps local callback verification across sibling channels and fences foreign or legacy hints without IO", async () => {
    const f = realHttp(); await mountReal();
    const { notifyBrowserAuthChanged } = await import("../browser-auth-notice");
    const observer = new BroadcastChannel("keryx-auth-v1"), peer = new BroadcastChannel("keryx-auth-v1");
    const delivered = () => new Promise<void>(done => { observer.onmessage = () => done(); });
    const drain = () => new Promise<void>(done => setTimeout(done, 0));
    try {
      await act(async () => {
        const notice = delivered(); notifyBrowserAuthChanged(); await notice; await drain();
      });
      expect(header.session?.address).toBe(alice);
      expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
      for (const hint of [{ type: "changed", source: "foreign-document" }, "changed"]) {
        const calls = f.authHttp.mock.calls.length, privateCalls = f.fetcher.mock.calls.length;
        await act(async () => {
          const notice = delivered(); peer.postMessage(hint); await notice; await drain();
        });
        cleared(f); expect(f.authHttp).toHaveBeenCalledTimes(calls);
        expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
        await freshSession();
        expect(header.session?.address).toBe(alice);
        expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
      }
      expect(confirmations).toEqual([]);
    } finally { observer.close(); peer.close(); }
  });

  it.each([
    ["list", "transport", "confirmed"], ["list", "body", "unconfirmed"],
    ["detail", "transport", "unconfirmed"], ["detail", "body", "confirmed"],
    ["export", "transport", "confirmed"], ["export", "body", "unconfirmed"],
  ] as const)("fences old %s %s before IO during delayed %s logout ACK", async (action, timing, acknowledgement) => {
    const f = realHttp(), oldTransport = waitFor<Response>();
    const raw = action === "list" ? page() : action === "detail" ? detail() : exported();
    const oldBody = heldBody(raw);
    if (action !== "list") await mountReal();
    f.respond(() => timing === "transport" ? oldTransport.promise : oldBody.response);
    if (action === "list") await mountReal(); else await click(action === "detail" ? "View saved result" : "Download JSON");
    expect(f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session")).toHaveLength(2);
    const oldSignal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
    const ackBody = waitFor<{ ok: boolean }>();
    const ack = Response.json({ ok: true }); vi.spyOn(ack, "json").mockImplementation(() => ackBody.promise);
    f.logout(init => {
      expect(oldSignal.aborted).toBe(true); // Initiation is synchronous BEFORE logout fetch.
      expect(init.signal).toBeTruthy(); expect(init).toMatchObject({ method: "POST", cache: "no-store" });
      return ack;
    });
    await click("Header sign out"); cleared(f);
    expect(header.authState).toBe("signing-out"); expect(headerError).toBe(""); expect(confirmations).toEqual([]);
    const lookups = f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session").length;
    await freshSession(); await act(async () => { await header.refresh(); });
    expect(f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session")).toHaveLength(lookups);
    await act(async () => { oldTransport.resolve(Response.json(raw)); oldBody.release(); });
    cleared(f);
    if (timing === "body") expect(oldBody.cancel).toHaveBeenCalled();
    await act(async () => {
      if (acknowledgement === "unconfirmed" && timing === "body") ackBody.reject(new Error("Acknowledgement JSON unavailable"));
      else ackBody.resolve({ ok: acknowledgement === "confirmed" });
    });
    cleared(f); expect(header.authState).toBe("idle");
    expect(confirmations).toEqual(acknowledgement === "confirmed" ? ["signed-out"] : []);
    if (acknowledgement === "unconfirmed") expect(container.querySelector("[data-header-error]")?.textContent).toBe("Sign-out could not be confirmed. Please retry.");
    f.respond(() => Response.json(page()));
    await freshSession();
    expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
    expect(f.downloads).toEqual([]); // Recovery requires NEW session and private HTTP.
  });

  it.each(["mount", "refresh"] as const)("rejects both real hooks' old in-flight %s session bodies after failed logout and allows retry/fresh verification", async phase => {
    const f = realHttp(), old = waitFor<{ session: ReturnType<typeof session> }>();
    if (phase === "refresh") await mountReal();
    f.lookup(() => { const response = Response.json({ session: session() }); vi.spyOn(response, "json").mockImplementation(() => old.promise); return response; });
    if (phase === "mount") await mountReal(); else await freshSession();
    const ack = waitFor<Response>(); f.logout(() => ack.promise);
    await click("Header sign out"); cleared(f);
    await act(async () => { ack.reject(new Error("lost acknowledgement")); });
    expect(headerError).toBe("Sign-out could not be confirmed. Please retry.");
    await act(async () => { old.resolve({ session: session() }); });
    cleared(f); expect(header.authState).toBe("idle");
    const retry = waitFor<Response>(); f.logout(() => retry.promise);
    await click("Header sign out"); cleared(f);
    await act(async () => { retry.resolve(Response.json({ ok: true })); }); cleared(f);
    f.lookup(() => Response.json({ session: session() })); f.respond(() => Response.json(page()));
    await freshSession(); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
  });

  it("keeps concurrent logout pending until every attempt ends, regardless of completion order", async () => {
    const f = realHttp(); await mountReal();
    const first = waitFor<Response>(), second = waitFor<Response>(); let calls = 0;
    f.logout(() => ++calls === 1 ? first.promise : second.promise);
    const attempts: Promise<unknown>[] = [];
    await act(async () => { attempts.push(header.signOut().catch(error => error), header.signOut().catch(error => error)); });
    cleared(f); expect(header.authState).toBe("signing-out");
    await act(async () => { second.resolve(Response.json({ ok: true })); });
    cleared(f); expect(header.authState).toBe("signing-out");
    const lookups = f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session").length;
    await freshSession(); expect(f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session")).toHaveLength(lookups);
    await act(async () => { first.resolve(Response.json({ ok: false })); await Promise.all(attempts); });
    cleared(f); expect(header.authState).toBe("idle");
    await freshSession(); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
  });

  it("ignores late/duplicate cross-tab logout snapshots after a fresh session", async () => {
    const f = realHttp(); await mountReal();
    const peer = new BroadcastChannel("keryx-auth-v1"), observer = new BroadcastChannel("keryx-auth-v1");
    const notify = async (sequence: number, pending: boolean) => {
      await act(async () => {
        const delivered = new Promise<void>(done => { observer.onmessage = () => done(); });
        peer.postMessage({ type: "logout", source: "other-tab", sequence, pending, confirmed: false });
        await delivered; await new Promise<void>(done => setTimeout(done, 0));
      });
    };
    try {
      await notify(2, false); cleared(f); // A terminal snapshot may arrive first.
      await freshSession(); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
      const calls = f.authHttp.mock.calls.length;
      await notify(1, true); await notify(2, false);
      expect(container.textContent).toContain("PRIVATE ALICE QUESTION"); expect(f.authHttp).toHaveBeenCalledTimes(calls);
      await notify(3, true); cleared(f); await freshSession(); cleared(f);
      await notify(4, false); cleared(f); await freshSession(); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
    } finally { peer.close(); observer.close(); }
  });

  describe("independent receiving MODULE survives the initiating hook", () => {
    // Two separately loaded actual auth modules have separate pending maps/epochs.
    // Native BroadcastChannel delivers snapshots. They share jsdom's window;
    // this is a module-lifetime regression fixture, not separate browser realms.
    let peerAuth: typeof useRealAuth, PeerWorkspace: typeof RealWorkspace;
    let receiver: ReturnType<typeof useRealAuth>;
    let initiatorRoot: Root | undefined, initiatorContainer: HTMLDivElement;
    let observer: BroadcastChannel, sender: BroadcastChannel | undefined;
    let signature: ReturnType<typeof vi.fn<(input: { message: string }) => Promise<string>>>;
    let connectorAddress: string;
    let fakeClock: boolean;

    function ReceiverActor() {
      receiver = peerAuth();
      return React.createElement("span", { "data-receiver-state": true }, receiver.authState + ":" + (receiver.session?.address ?? "cleared"));
    }
    async function mountIndependent() {
      await act(async () => {
        initiatorRoot = createRoot(initiatorContainer);
        initiatorRoot.render(React.createElement(HeaderActor));
        root = createRoot(container);
        root.render(React.createElement(React.Fragment, null, React.createElement(ReceiverActor), React.createElement(PeerWorkspace)));
      });
    }
    async function drainChannel() {
      if (fakeClock) await vi.advanceTimersByTimeAsync(0);
      else await new Promise<void>(done => setTimeout(done, 0));
    }
    function noticeDelivered(match: (data: any) => boolean) {
      const delivered = waitFor<{ source: string; sequence: number; pending: boolean; confirmed: boolean }>();
      observer.onmessage = event => { if (match(event.data)) delivered.resolve(event.data); };
      return delivered.promise;
    }
    async function notify(source: string, sequence: number, pending: boolean) {
      await act(async () => {
        const delivered = noticeDelivered(data => data?.source === source && data.sequence === sequence);
        sender ??= new BroadcastChannel("keryx-auth-v1");
        sender.postMessage({ type: "logout", source, sequence, pending, confirmed: false });
        await delivered; await drainChannel();
      });
    }
    const peerCleared = (f: ReturnType<typeof realHttp>) => {
      expect(receiver.session).toBeNull();
      expect(container.querySelector("form")).toBeNull();
      expect(container.textContent).not.toContain("PRIVATE ALICE");
      expect(container.textContent).not.toContain("PRIVATE SAVED ANSWER");
      expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]);
    };
    const lookupCount = (f: ReturnType<typeof realHttp>) => f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session").length;

    beforeEach(async () => {
      signature = vi.fn<(input: { message: string }) => Promise<string>>(async () => "0xfixture-signature");
      connectorAddress = alice;
      vi.doMock("wagmi", () => ({ useAccount: () => ({ address: connectorAddress, isConnected: true, connector: { id: "injected" } }),
        useSignMessage: () => ({ signMessageAsync: signature }) }));
      vi.resetModules();
      peerAuth = (await import("../hooks/use-siwe-auth")).useSiweAuth;
      PeerWorkspace = (await import("@/components/keryx/private-job-history-workspace")).PrivateJobHistoryWorkspace;
      expect(peerAuth).not.toBe(useRealAuth); // A shared map would conceal the regression.
      initiatorContainer = document.createElement("div"); document.body.append(initiatorContainer);
      observer = new BroadcastChannel("keryx-auth-v1"); fakeClock = false;
    });
    afterEach(async () => {
      if (initiatorRoot) await act(async () => { initiatorRoot!.unmount(); });
      initiatorRoot = undefined; initiatorContainer.remove(); observer.close(); sender?.close(); sender = undefined;
    });

    it.each(["confirmed", "unconfirmed"] as const)("delivers %s terminal ACK after ONLY initiator unmount; rejects old export/session and recovers by fresh HTTP", async acknowledgement => {
      const f = realHttp(); await mountIndependent();
      const oldExport = heldBody(exported()); f.respond(() => oldExport.response); await click("Download JSON");
      const oldSignal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
      const oldSession = waitFor<{ session: ReturnType<typeof session> }>();
      f.lookup(() => { const response = Response.json({ session: session() }); vi.spyOn(response, "json").mockImplementation(() => oldSession.promise); return response; });
      let refresh!: Promise<unknown>; await act(async () => { refresh = receiver.refresh(); });
      const ack = waitFor<{ ok: boolean }>(), response = Response.json({ ok: true });
      vi.spyOn(response, "json").mockImplementation(() => ack.promise);
      f.logout(init => { expect(oldSignal.aborted).toBe(true); expect(init.signal).toBeTruthy(); return response; });
      let signout!: Promise<unknown>, started!: Awaited<ReturnType<typeof noticeDelivered>>;
      await act(async () => {
        const delivered = noticeDelivered(data => data?.type === "logout" && data.pending);
        signout = header.signOut().catch(error => error);
        started = await delivered; await drainChannel();
      });
      peerCleared(f); expect(receiver.authState).toBe("signing-out"); expect(confirmations).toEqual([]);
      await act(async () => { initiatorRoot!.unmount(); initiatorRoot = undefined; });
      expect(container.querySelector("[data-receiver-state]")).toBeTruthy(); // The receiving lifetime remains mounted.
      const lookups = lookupCount(f), privateCalls = f.fetcher.mock.calls.length;
      await freshSession(); await act(async () => { expect(await receiver.signIn()).toEqual({ ok: false }); });
      expect(lookupCount(f)).toBe(lookups); expect(signature).not.toHaveBeenCalled();
      await act(async () => { oldExport.release(); oldSession.resolve({ session: session() }); await refresh; });
      peerCleared(f); expect(oldExport.cancel).toHaveBeenCalled();

      await act(async () => {
        const terminal = noticeDelivered(data => data?.source === started.source && !data.pending);
        if (acknowledgement === "confirmed") ack.resolve({ ok: true });
        else ack.reject(new Error("ACK JSON lost after unmount"));
        const result = await signout, ended = await terminal; await drainChannel();
        expect(ended.sequence).toBeGreaterThan(started.sequence);
        expect(ended.confirmed).toBe(acknowledgement === "confirmed");
        if (acknowledgement === "unconfirmed") expect(result).toEqual(new Error("Sign-out could not be confirmed. Please retry."));
      });
      peerCleared(f); expect(receiver.authState).toBe("idle");
      expect(confirmations.length > 0).toBe(acknowledgement === "confirmed");
      expect(lookupCount(f)).toBe(lookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
      f.lookup(() => Response.json({ session: null })); await freshSession(); peerCleared(f);
      expect(f.fetcher).toHaveBeenCalledTimes(privateCalls); // Even explicit recovery needs verified auth.
      f.lookup(() => Response.json({ session: session() })); f.respond(() => Response.json(page()));
      await freshSession(); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
      expect(lookupCount(f)).toBeGreaterThan(lookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls + 1);
      expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]);
    });

    it("expires abandoned peers separately without confirmation, stale/duplicate replay or anonymous automatic private IO", async () => {
      const f = realHttp(); await mountIndependent();
      const oldExport = heldBody(exported()); f.respond(() => oldExport.response); await click("Download JSON");
      const signal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
      vi.useFakeTimers(); fakeClock = true;
      await notify("abandoned-one", 2, true); expect(signal.aborted).toBe(true); peerCleared(f);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      await notify("abandoned-two", 1, true);
      sender!.close(); sender = undefined; // No terminal notice can come from this abandoned sender.
      const lookups = lookupCount(f), privateCalls = f.fetcher.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); oldExport.release(); });
      peerCleared(f); expect(receiver.authState).toBe("signing-out"); // One source expired; the other is still pending.
      await freshSession(); expect(lookupCount(f)).toBe(lookups);
      await act(async () => { expect(await receiver.signIn()).toEqual({ ok: false }); await vi.advanceTimersByTimeAsync(5000); });
      peerCleared(f); expect(receiver.authState).toBe("idle"); expect(confirmations).toEqual([]);
      expect(lookupCount(f)).toBe(lookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
      f.lookup(() => Response.json({ session: null })); await freshSession(); peerCleared(f);
      f.lookup(() => Response.json({ session: session() })); f.respond(() => Response.json(page()));
      await freshSession(); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
      const freshLookups = lookupCount(f), freshPrivate = f.fetcher.mock.calls.length;
      await notify("abandoned-one", 1, true); await notify("abandoned-one", 2, true); await notify("abandoned-two", 1, true);
      expect(receiver.authState).toBe("idle"); expect(container.textContent).toContain("PRIVATE ALICE QUESTION");
      expect(lookupCount(f)).toBe(freshLookups); expect(f.fetcher).toHaveBeenCalledTimes(freshPrivate);
      await act(async () => {
        const delivered = noticeDelivered(data => data === "changed");
        sender!.postMessage("changed"); await delivered; await drainChannel();
      });
      peerCleared(f); expect(lookupCount(f)).toBe(freshLookups); expect(f.fetcher).toHaveBeenCalledTimes(freshPrivate);
      expect(confirmations).toEqual([]);
    });

    it("expires at the first observed 20000ms start despite increasing peer sequences and refuses renewed pending/confirmation claims", async () => {
      const f = realHttp(); await mountIndependent();
      const oldExport = heldBody(exported()); f.respond(() => oldExport.response); await click("Download JSON");
      const signal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
      const oldSession = waitFor<{ session: ReturnType<typeof session> }>();
      f.lookup(() => { const response = Response.json({ session: session() }); vi.spyOn(response, "json").mockImplementation(() => oldSession.promise); return response; });
      let refresh!: Promise<unknown>; await act(async () => { refresh = receiver.refresh(); });
      vi.useFakeTimers(); fakeClock = true;
      await notify("increasing-peer", 1, true); expect(signal.aborted).toBe(true); peerCleared(f);
      const lookups = lookupCount(f), privateCalls = f.fetcher.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); await notify("increasing-peer", 2, true);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); await notify("increasing-peer", 3, true);
      await act(async () => { await vi.advanceTimersByTimeAsync(9999); }); await notify("increasing-peer", 4, true);
      sender!.close(); sender = undefined; // No ACK; last higher sequence arrived at t=19999.
      peerCleared(f); expect(receiver.authState).toBe("signing-out");
      await freshSession(); await act(async () => { expect(await receiver.signIn()).toEqual({ ok: false }); });
      expect(lookupCount(f)).toBe(lookups); expect(signature).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); }); // Exact first-start boundary, not last-sequence + 20s.
      peerCleared(f); expect(receiver.authState).toBe("idle"); expect(confirmations).toEqual([]);
      await act(async () => { oldExport.release(); oldSession.resolve({ session: session() }); expect(await refresh).toBeNull(); });
      peerCleared(f); expect(oldExport.cancel).toHaveBeenCalled();
      await notify("increasing-peer", 5, true); // A higher sequence after expiry cannot start another lease.
      peerCleared(f); expect(receiver.authState).toBe("idle");
      await act(async () => {
        const delivered = noticeDelivered(value => value?.source === "increasing-peer" && value.sequence === 6);
        sender!.postMessage({ type: "logout", source: "increasing-peer", sequence: 6, pending: true, confirmed: true });
        await delivered; await drainChannel(); sender!.close(); sender = undefined;
      });
      peerCleared(f); expect(receiver.authState).toBe("idle"); expect(confirmations).toEqual([]);
      expect(lookupCount(f)).toBe(lookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
      f.lookup(() => Response.json({ session: null })); await freshSession(); peerCleared(f);
      f.lookup(() => Response.json({ session: session() })); f.respond(() => Response.json(page())); await freshSession();
      expect(container.textContent).toContain("PRIVATE ALICE QUESTION"); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls + 1);
      expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]); expect(confirmations).toEqual([]);
    });

    it("retains fresh held session/private recovery through higher pending notices of an exhausted interval, but fences genuine new boundaries", async () => {
      const f = realHttp(); await mountIndependent();
      const oldExport = heldBody(exported()); f.respond(() => oldExport.response); await click("Download JSON");
      const oldSignal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
      const oldSession = waitFor<{ session: ReturnType<typeof session> }>();
      f.lookup(() => { const response = Response.json({ session: session() }); vi.spyOn(response, "json").mockImplementation(() => oldSession.promise); return response; });
      let oldRefresh!: Promise<unknown>; await act(async () => { oldRefresh = receiver.refresh(); });
      vi.useFakeTimers(); fakeClock = true;
      await notify("exhausted-recovery-peer", 1, true); expect(oldSignal.aborted).toBe(true); peerCleared(f);
      const lookups = lookupCount(f), privateCalls = f.fetcher.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(19999); });
      expect(receiver.authState).toBe("signing-out");
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      peerCleared(f); expect(receiver.authState).toBe("idle"); expect(confirmations).toEqual([]);
      expect(lookupCount(f)).toBe(lookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
      await act(async () => { oldExport.release(); oldSession.resolve({ session: session() }); expect(await oldRefresh).toBeNull(); });
      peerCleared(f); expect(oldExport.cancel).toHaveBeenCalled();

      // Start genuine fresh HTTP AFTER expiry; hold its successful JSON, rather
      // than publishing auth from a channel notice or reusing the pre-boundary body.
      const verified = session(), freshSessionBody = waitFor<{ session: ReturnType<typeof session> }>();
      const sessionJson = vi.fn(() => freshSessionBody.promise);
      f.lookup(() => { const response = Response.json({ session: verified }); vi.spyOn(response, "json").mockImplementation(sessionJson); return response; });
      const freshHistory = heldBody(page([row(alice, "2")])); f.respond(() => freshHistory.response);
      await freshSession(); expect(sessionJson).toHaveBeenCalled();
      const freshLookups = lookupCount(f); expect(freshLookups).toBeGreaterThan(lookups);
      await notify("exhausted-recovery-peer", 2, true); // Same exhausted interval while fresh session JSON is held.
      peerCleared(f); expect(receiver.authState).toBe("idle");
      expect(lookupCount(f)).toBe(freshLookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
      await act(async () => { freshSessionBody.resolve({ session: verified }); });
      expect(receiver.session).toBe(verified); expect(header.session).toBe(verified);
      expect(f.fetcher).toHaveBeenCalledTimes(privateCalls + 1);
      const freshSignal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
      expect(freshSignal.aborted).toBe(false); expect(container.textContent).not.toContain("PRIVATE ALICE QUESTION");

      // The same exhausted interval also cannot abort a newly verified private
      // body, even when the channel sender claims confirmation.
      await act(async () => {
        const delivered = noticeDelivered(value => value?.source === "exhausted-recovery-peer" && value.sequence === 3);
        sender!.postMessage({ type: "logout", source: "exhausted-recovery-peer", sequence: 3, pending: true, confirmed: true });
        await delivered; await drainChannel();
      });
      expect(receiver.session).toBe(verified); expect(freshSignal.aborted).toBe(false);
      await act(async () => { freshHistory.release(); });
      expect(container.textContent).toContain("PRIVATE ALICE QUESTION 2");
      expect(freshSignal.aborted).toBe(true); // Successful reader cleanup, before any later boundary.
      for (const sequence of [4, 5, 6, 7]) {
        await notify("exhausted-recovery-peer", sequence, true); // Higher notices AFTER actual private body recovery.
        expect(receiver.session).toBe(verified); expect(header.session).toBe(verified);
        expect(receiver.authState).toBe("idle");
        expect(container.textContent).toContain("PRIVATE ALICE QUESTION 2");
        expect(lookupCount(f)).toBe(freshLookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls + 1);
      }
      await notify("exhausted-recovery-peer", 6, false); // The ordering tombstone still rejects an older terminal.
      expect(receiver.session).toBe(verified);
      expect(container.textContent).toContain("PRIVATE ALICE QUESTION 2");
      expect(confirmations).toEqual([]); expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]);

      const terminalBody = heldBody(detail(row(alice, "2"))); f.respond(() => terminalBody.response);
      await click("View saved result");
      const terminalSignal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
      expect(terminalSignal.aborted).toBe(false); // A distinct LIVE request establishes causal cancellation.
      await notify("exhausted-recovery-peer", 8, false); // An accepted terminal IS a new privacy boundary.
      peerCleared(f); expect(receiver.authState).toBe("idle"); expect(terminalSignal.aborted).toBe(true);
      await act(async () => { terminalBody.release(); }); peerCleared(f);
      await notify("exhausted-recovery-peer", 9, true); // A later interval gets its genuine pending boundary.
      peerCleared(f); expect(receiver.authState).toBe("signing-out");
      await freshSession(); expect(lookupCount(f)).toBe(freshLookups); expect(signature).not.toHaveBeenCalled();
      await notify("exhausted-recovery-peer", 10, false);
      peerCleared(f); expect(receiver.authState).toBe("idle"); expect(confirmations).toEqual([]);
      expect(f.fetcher).toHaveBeenCalledTimes(privateCalls + 2);
    });

    it.each(["nonce", "signature", "verify"] as const)("cannot resume old %s sign-in after an abandoned logout expires", async stage => {
      const f = realHttp(); connectorAddress = getAddress(alice); await mountIndependent();
      const nonce = { nonce: "a123456789", issuedAt: "2026-10-14T00:00:00.000Z",
        challengeExpiresAt: "2026-10-14T00:05:00.000Z", sessionExpiresAt: "2026-10-21T00:00:00.000Z" };
      const challenge = waitFor<typeof nonce>(), signed = waitFor<string>(), verified = waitFor<{ ok: boolean; address: string; role: string }>();
      signature.mockImplementation(() => stage === "signature" ? signed.promise : Promise.resolve("0xfixture-signature"));
      const signingHttp = vi.fn<typeof fetch>(async (path, init) => {
        if (path === "/api/auth/nonce") {
          const response = Response.json(nonce); if (stage === "nonce") vi.spyOn(response, "json").mockImplementation(() => challenge.promise); return response;
        }
        if (path === "/api/auth/verify") {
          const response = Response.json({ ok: true, address: alice, role: "asker" });
          vi.spyOn(response, "json").mockImplementation(() => verified.promise); return response;
        }
        return f.authHttp(path, init);
      });
      vi.stubGlobal("fetch", signingHttp);
      let signing!: ReturnType<typeof receiver.signIn>;
      await act(async () => { signing = receiver.signIn(); });
      if (stage === "nonce") expect(signature).not.toHaveBeenCalled(); else expect(signature).toHaveBeenCalledTimes(1);
      expect(signingHttp.mock.calls.filter(([path]) => path === "/api/auth/verify")).toHaveLength(stage === "verify" ? 1 : 0);
      vi.useFakeTimers(); fakeClock = true;
      await notify("abandoned-during-sign-in", 1, true); peerCleared(f);
      const lookups = lookupCount(f), privateCalls = f.fetcher.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
        challenge.resolve(nonce); signed.resolve("0xfixture-late-signature"); verified.resolve({ ok: true, address: alice, role: "asker" });
        expect(await signing).toEqual({ ok: false });
      });
      peerCleared(f); expect(receiver.authState).toBe("idle"); expect(confirmations).toEqual([]);
      expect(lookupCount(f)).toBe(lookups); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
      expect(signingHttp.mock.calls.filter(([path]) => path === "/api/auth/verify")).toHaveLength(stage === "verify" ? 1 : 0);
      if (stage === "nonce") expect(signature).not.toHaveBeenCalled();
      f.lookup(() => Response.json({ session: null })); await freshSession(); peerCleared(f);
      f.lookup(() => Response.json({ session: session() })); await freshSession();
      expect(container.textContent).toContain("PRIVATE ALICE QUESTION"); expect(f.downloads).toEqual([]);
    });
  });

  describe("local publisher authority and finite peer start", () => {
    // Reuse the native channel/actual-hook fixture above; assertions remain
    // module/DOM evidence only. Separate browser realms are a parent gate.
    it.each([true, false])("ignores peer pending:%s claiming the advertised local source/high sequence, then accepts the real ACK", async pending => {
      const f = realHttp(); await mountReal();
      const observer = new BroadcastChannel("keryx-auth-v1"), peer = new BroadcastChannel("keryx-auth-v1");
      const delivered = (match: (value: any) => boolean) => new Promise<{ source: string; sequence: number; pending: boolean; confirmed: boolean }>(done => {
        observer.onmessage = event => { if (match(event.data)) done(event.data); };
      });
      const drain = () => new Promise<void>(done => setTimeout(done, 0));
      try {
        const oldExport = heldBody(exported()); f.respond(() => oldExport.response); await click("Download JSON");
        const signal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
        const oldSession = waitFor<{ session: ReturnType<typeof session> }>();
        f.lookup(() => { const response = Response.json({ session: session() }); vi.spyOn(response, "json").mockImplementation(() => oldSession.promise); return response; });
        let refresh!: Promise<unknown>; await act(async () => { refresh = header.refresh(); });
        const ack = waitFor<{ ok: boolean }>(), response = Response.json({ ok: true });
        vi.spyOn(response, "json").mockImplementation(() => ack.promise);
        f.logout(init => { expect(signal.aborted).toBe(true); expect(init.signal).toBeTruthy(); return response; });
        let signout!: Promise<unknown>, started!: Awaited<ReturnType<typeof delivered>>;
        await act(async () => {
          const start = delivered(value => value?.type === "logout" && value.pending);
          signout = header.signOut().catch(error => error); started = await start; await drain();
        });
        // Learn S from the actual publisher, rather than predicting/injecting it.
        expect(started.source).toBeTruthy(); expect(started.sequence).toBe(1);
        await act(async () => {
          const forged = delivered(value => value?.source === started.source && value.sequence === Number.MAX_SAFE_INTEGER);
          peer.postMessage({ type: "logout", source: started.source, sequence: Number.MAX_SAFE_INTEGER, pending, confirmed: true });
          await forged; await drain(); peer.close();
        });
        cleared(f); expect(header.authState).toBe("signing-out"); expect(confirmations).toEqual([]);
        const lookups = f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session").length, privateCalls = f.fetcher.mock.calls.length;
        await freshSession(); await act(async () => { expect(await header.refresh()).toBeNull(); expect(await header.signIn()).toEqual({ ok: false }); });
        expect(f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session")).toHaveLength(lookups);
        await act(async () => { oldExport.release(); oldSession.resolve({ session: session() }); expect(await refresh).toBeNull(); });
        cleared(f); expect(oldExport.cancel).toHaveBeenCalled();
        // Only the owned attempt's HTTP-success/JSON-ok completion ends it.
        await act(async () => {
          const terminal = delivered(value => value?.source === started.source && !value.pending && value.sequence === started.sequence + 1);
          ack.resolve({ ok: true }); expect(await signout).toBeUndefined();
          expect(await terminal).toMatchObject({ sequence: 2, pending: false, confirmed: true }); await drain();
        });
        cleared(f); expect(header.authState).toBe("idle"); expect(confirmations).toEqual(["signed-out"]);
        expect(f.authHttp.mock.calls.filter(([path]) => path === "/api/auth/session")).toHaveLength(lookups);
        expect(f.fetcher).toHaveBeenCalledTimes(privateCalls);
        f.lookup(() => Response.json({ session: null })); await freshSession(); cleared(f);
        f.lookup(() => Response.json({ session: session() })); f.respond(() => Response.json(page())); await freshSession();
        expect(container.textContent).toContain("PRIVATE ALICE QUESTION"); expect(f.fetcher).toHaveBeenCalledTimes(privateCalls + 1);
        expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]);
      } finally { peer.close(); observer.close(); }
    });
  });

  it("unmounts both real hooks safely with private body, session lookup and logout ACK outstanding", async () => {
    const f = realHttp(); await mountReal();
    const old = heldBody(exported()); f.respond(() => old.response); await click("Download JSON");
    const signal = f.fetcher.mock.calls.at(-1)![1]!.signal!;
    const sessionLookup = waitFor<Response>(); f.lookup(() => sessionLookup.promise);
    let refresh!: Promise<unknown>; await act(async () => { refresh = header.refresh(); });
    const ack = waitFor<Response>(); f.logout(() => ack.promise);
    let signout!: Promise<unknown>; await act(async () => { signout = header.signOut().catch(error => error); });
    await act(async () => { root!.unmount(); root = undefined; });
    expect(signal.aborted).toBe(true); expect(old.cancel).toHaveBeenCalled();
    await act(async () => { old.release(); sessionLookup.resolve(Response.json({ session: session() })); ack.resolve(Response.json({ ok: false })); await refresh; await signout; });
    expect(container.textContent).toBe(""); expect(f.downloads).toEqual([]); expect(f.blobs).toEqual([]);
  });
});

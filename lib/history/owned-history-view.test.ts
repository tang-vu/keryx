// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnedHistoryPane } from "@/app/me/asks/owned-history-view";
import { ownedHistoryCopy as copy } from "@/locales/en/owned-history";
import type { OwnedHistoryPage, OwnedHistoryRow } from "./owned-history";

// Only authentication, HTTP and the browser download boundary are controlled.
// The pane, view, form handling, bounded readers and schemas are the real modules.
const auth = vi.hoisted(() => ({ session: undefined as { address: string; role: string } | null | undefined }));
vi.mock("@/lib/hooks/use-siwe-auth", () => ({ useSiweAuth: () => ({ session: auth.session }) }));
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
type RequestRecord = { url: URL; init: RequestInit };
type Operation = "report" | "export";
let root: Root | undefined, container: HTMLDivElement;
let requests: RequestRecord[], downloads: { href: string; name: string }[];
let respond: (request: RequestRecord) => Response | Promise<Response>;
let listQuestion: string;
const createObjectURL = vi.fn((_blob: Blob) => "blob:synthetic-owned-history");
const revokeObjectURL = vi.fn((_href: string) => undefined);

function row(owner = alice, question = "Alice ready", id = owner === alice ? "alice-run" : "bob-run"): OwnedHistoryRow {
  return {
    id, ownerWallet: owner, createdAt: "2026-10-13T00:00:00.000Z", question,
    provenance: null, ownership: { method: "recorded", claimedAt: null }, visibility: "private", revision: 7,
    networks: ["eip155:5042"], funding: "mixed", recordedSpendUsdc: 1, recordedCreatorAllocationUsdc: 0.5,
    paymentMode: "real", isFollowUp: false, ownSettledSpendMicros: 1_000_000, sponsoredSettledSpendMicros: 2_000_000,
    receiptsTruncated: false,
    paidCreators: [{ sourceId: "synthetic-source", name: "Synthetic creator", payee: bob, amountMicros: 500_000,
      network: "eip155:5042", reference: "synthetic-receipt" }],
    links: { report: `/api/me/asks/${id}`, receipts: `/api/me/asks/${id}?format=receipts`,
      references: `/api/me/asks/${id}?format=bibtex`, privacy: `/api/me/run-privacy/${id}` },
  };
}
function page(owner = alice, question = listQuestion): OwnedHistoryPage {
  return { version: 2, wallet: owner, scope: "wallet-owned-current-store", storeNetwork: "eip155:5042",
    membershipAvailable: false, claimsAvailable: false, rows: [row(owner, question)], nextCursor: null, scanLimited: false };
}
function report(answer = "Synthetic private answer", owner = alice, id = "alice-run") {
  return { wallet: owner, run: { id, answer } };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function heldBody() {
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(value) { control = value; }, cancel: cancelled });
  const response = new Response(stream);
  return { response, cancelled,
    bytes: (value: Uint8Array) => control.enqueue(value),
    close: () => control.close(),
    finish: (value: unknown) => { control.enqueue(new TextEncoder().encode(JSON.stringify(value))); control.close(); },
    fail: () => control.error(new Error("Synthetic delayed body failure")),
  };
}
function isOperation(request: RequestRecord, operation: Operation) {
  return request.url.pathname === (operation === "report" ? "/api/me/asks/alice-run" : "/api/me/asks/export");
}
function button(name: string) {
  const value = Array.from(container.querySelectorAll("button")).find(node => node.textContent === name);
  expect(value, `Expected real DOM button: ${name}`).toBeDefined();
  return value!;
}
async function renderPane() {
  root ??= createRoot(container);
  await act(async () => { root!.render(createElement(OwnedHistoryPane)); });
}
async function click(name: string) { await act(async () => { button(name).click(); }); }
async function applyFilters(search = "fresh") {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[name="search"]')!;
    input.value = search;
    input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function unmount() {
  await act(async () => { root!.unmount(); }); root = undefined;
}
function ready(question = listQuestion) {
  expect(container.querySelector("h3")?.textContent).toBe(question);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
}
function expectRead(request: RequestRecord, owner = alice) {
  expect(new Headers(request.init.headers).get("X-Keryx-Expected-Wallet")).toBe(owner);
  expect(request.init.cache).toBe("no-store");
  expect(request.init.method ?? "GET").toBe("GET");
  expect(request.init.body).toBeUndefined();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  auth.session = { address: alice, role: "asker" }; requests = []; downloads = []; listQuestion = "Alice ready";
  container = document.createElement("div"); document.body.append(container);
  respond = request => {
    if (request.url.pathname !== "/api/me/asks") throw new Error("Unexpected synthetic HTTP request");
    const owner = new Headers(request.init.headers).get("X-Keryx-Expected-Wallet")!;
    return Response.json(page(owner, owner === alice ? listQuestion : "Bob ready"));
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = { url: new URL(String(input), "https://synthetic.example"), init };
    requests.push(request); return respond(request);
  }));
  createObjectURL.mockClear(); revokeObjectURL.mockClear();
  const NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, name: this.download });
  });
});
afterEach(async () => {
  if (root) await unmount();
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("keeps authentication checking and signed-out states free of history reads", async () => {
  auth.session = undefined; await renderPane();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.checking); expect(requests).toHaveLength(0);
  auth.session = null; await renderPane();
  expect(container.textContent).toBe(copy.signedOut); expect(requests).toHaveLength(0);
});

it.each([
  ["report", "fetch"], ["report", "body"], ["export", "fetch"], ["export", "body"],
] as const)("ignores an old %s %s rejection after the new filter is ready", async (operation, stage) => {
  await renderPane(); ready();
  const waiting = deferred<Response>(), body = heldBody(), ordinary = respond;
  respond = request => isOperation(request, operation) ? stage === "fetch" ? waiting.promise : body.response : ordinary(request);
  await click(operation === "report" ? copy.report : copy.exportJson);
  const old = requests.at(-1)!; expectRead(old); expect(old.init.signal?.aborted).toBe(false);
  if (stage === "body") expect(body.response.body?.locked).toBe(true);
  listQuestion = "New filter ready"; await applyFilters(); ready();
  expect(old.init.signal?.aborted).toBe(true);
  expect(requests.at(-1)!.url.searchParams.get("search")).toBe("fresh");
  await act(async () => { if (stage === "fetch") waiting.reject(new Error("Synthetic old request failure")); else body.fail(); });
  ready(); expect(container.querySelector("pre")).toBeNull(); expect(downloads).toEqual([]);
  expect(requests).toHaveLength(3); // No automatic retry or replay after stale failure.
  if (stage === "body") expect(body.response.body?.locked).toBe(false);
});

it.each(["report", "export"] as const)("keeps the new generation's current failure when an old %s fails", async operation => {
  await renderPane();
  const waiting = deferred<Response>(), ordinary = respond;
  respond = request => isOperation(request, operation) ? waiting.promise : ordinary(request);
  await click(operation === "report" ? copy.report : copy.exportCsv);
  respond = request => request.url.pathname === "/api/me/asks" ? new Response(null, { status: 503 }) : waiting.promise;
  await applyFilters(); expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.unavailable);
  await act(async () => { waiting.reject(new Error("Synthetic old failure")); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.unavailable);
  expect(container.querySelector("h3")).toBeNull(); expect(downloads).toEqual([]);
});

it.each([
  ["list", "signout"], ["list", "switch"], ["list", "unmount"],
  ["report", "signout"], ["report", "switch"], ["report", "unmount"],
  ["export", "signout"], ["export", "switch"], ["export", "unmount"],
] as const)("discards delayed %s body bytes after owner %s", async (operation, transition) => {
  const body = heldBody(), ordinary = respond;
  if (operation !== "list") await renderPane();
  respond = request => new Headers(request.init.headers).get("X-Keryx-Expected-Wallet") === alice &&
    (operation === "list" ? request.url.pathname === "/api/me/asks" : isOperation(request, operation)) ? body.response : ordinary(request);
  if (operation === "list") await renderPane(); else await click(operation === "report" ? copy.report : copy.exportJson);
  const old = requests.at(-1)!; expect(body.response.body?.locked).toBe(true);
  if (transition === "unmount") await unmount();
  else { auth.session = transition === "signout" ? null : { address: bob, role: "asker" }; await renderPane(); }
  expect(old.init.signal?.aborted).toBe(true);
  await act(async () => { body.finish(operation === "list" ? page(alice, "Stale private question") : operation === "report" ? report("Stale private answer") : { syntheticPrivateExport: true }); });
  expect(body.response.body?.locked).toBe(false);
  expect(container.textContent).not.toContain("Stale private"); expect(container.querySelector("pre")).toBeNull();
  expect(downloads).toEqual([]); expect(createObjectURL).not.toHaveBeenCalled();
  if (transition === "switch") ready("Bob ready");
  else expect(container.textContent).toBe(transition === "signout" ? copy.signedOut : "");
});

it.each(["report", "export"] as const)("cancels an old %s response delivered after filter refresh without consuming or emitting it", async operation => {
  await renderPane();
  const waiting = deferred<Response>(), body = heldBody(), ordinary = respond;
  respond = request => isOperation(request, operation) ? waiting.promise : ordinary(request);
  await click(operation === "report" ? copy.report : copy.exportJson);
  listQuestion = "Refreshed ready"; await applyFilters();
  await act(async () => { waiting.resolve(body.response); });
  ready(); expect(body.cancelled).toHaveBeenCalledTimes(1); expect(body.response.body?.locked).toBe(false);
  expect(container.querySelector("pre")).toBeNull(); expect(downloads).toEqual([]); expect(requests).toHaveLength(3);
});

it.each(["list", "report", "export"] as const)("reports a current %s failure and recovers only on explicit refresh/retry", async operation => {
  const ordinary = respond;
  if (operation !== "list") await renderPane();
  respond = request => (operation === "list" ? request.url.pathname === "/api/me/asks" : isOperation(request, operation)) ? new Response(null, { status: 503 }) : ordinary(request);
  if (operation === "list") await renderPane(); else await click(operation === "report" ? copy.report : copy.exportJson);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(operation === "list" ? copy.unavailable : copy.failed);
  const count = requests.length; await act(async () => {}); expect(requests).toHaveLength(count);
  respond = request => isOperation(request, "report") ? Response.json(report("Retry answer")) : isOperation(request, "export") ? Response.json({ syntheticExport: true }) : ordinary(request);
  await click(copy.refresh); ready(); expect(requests).toHaveLength(count + 1);
  if (operation === "report") { await click(copy.report); expect(container.querySelector("pre")?.textContent).toBe("Retry answer"); }
  if (operation === "export") { await click(copy.exportJson); expect(downloads.map(value => value.name)).toEqual(["keryx-history.json"]); }
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it.each(["list", "report", "export"] as const)("enforces the current %s byte bound and releases the failed body reader", async operation => {
  const body = heldBody(), ordinary = respond;
  if (operation !== "list") await renderPane();
  respond = request => (operation === "list" ? request.url.pathname === "/api/me/asks" : isOperation(request, operation)) ? body.response : ordinary(request);
  if (operation === "list") await renderPane(); else await click(operation === "report" ? copy.report : copy.exportJson);
  const limit = (operation === "list" ? 2 : operation === "report" ? 4 : 8) * 1024 * 1024;
  await act(async () => { body.bytes(new Uint8Array(limit)); body.bytes(new Uint8Array(1)); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(operation === "list" ? copy.unavailable : copy.failed);
  expect(body.cancelled).toHaveBeenCalledTimes(1); expect(body.response.body?.locked).toBe(false);
  expect(createObjectURL).not.toHaveBeenCalled(); expect(container.querySelector("pre")).toBeNull();
});

it("allows an export exactly at the existing 8 MiB stream bound and releases its reader", async () => {
  await renderPane(); const body = heldBody(), ordinary = respond;
  respond = request => isOperation(request, "export") ? body.response : ordinary(request);
  await click(copy.exportJson);
  await act(async () => { body.bytes(new Uint8Array(8 * 1024 * 1024)); body.close(); });
  expect(downloads.map(value => value.name)).toEqual(["keryx-history.json"]);
  expect(createObjectURL.mock.calls[0][0].size).toBe(8 * 1024 * 1024);
  expect(body.response.body?.locked).toBe(false); expect(revokeObjectURL).toHaveBeenCalledTimes(1); ready();
});

it.each(["wallet", "row", "links"] as const)("rejects a list %s mismatch instead of rendering unvalidated private rows", async mismatch => {
  const value = page();
  if (mismatch === "wallet") value.wallet = bob;
  if (mismatch === "row") value.rows[0].revision = -1;
  if (mismatch === "links") value.rows[0].links.report = "/api/me/asks/someone-else";
  const body = heldBody(); respond = () => body.response;
  await renderPane(); await act(async () => { body.finish(value); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.unavailable);
  expect(container.querySelector("article")).toBeNull(); expect(body.response.body?.locked).toBe(false);
});

it.each(["wallet", "id", "answer"] as const)("rejects a current report %s schema mismatch and releases its reader", async mismatch => {
  await renderPane();
  const body = heldBody(), ordinary = respond;
  respond = request => isOperation(request, "report") ? body.response : ordinary(request);
  await click(copy.report);
  const value: { wallet: string; run: { id: string; answer: unknown } } = report();
  if (mismatch === "wallet") value.wallet = bob;
  if (mismatch === "id") value.run.id = "different-run";
  if (mismatch === "answer") value.run.answer = 42;
  await act(async () => { body.finish(value); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.failed);
  expect(container.querySelector("pre")).toBeNull(); expect(body.response.body?.locked).toBe(false);
});

it("preserves current-owner list, safe report text, filter-wide JSON/CSV and row downloads", async () => {
  const unsafeText = '<img data-private-injection onerror="alert(1)">';
  listQuestion = unsafeText; await renderPane(); ready();
  expect(container.querySelector("[data-private-injection]")).toBeNull();
  expect(container.textContent).toContain(copy.walletOnly); expect(container.textContent).toContain(copy.claimsMissing);
  expect(container.textContent).toContain("Synthetic creator");
  const ordinary = respond;
  respond = request => request.url.pathname === "/api/me/asks/alice-run" && !request.url.search ? Response.json(report(unsafeText)) :
    request.url.pathname === "/api/me/asks/export" || request.url.pathname === "/api/me/asks/alice-run" ? Response.json({ syntheticDownload: true }) : ordinary(request);
  await click(copy.report); expect(container.querySelector("pre")?.textContent).toBe(unsafeText);
  expect(container.querySelector("[data-private-injection]")).toBeNull(); await click(copy.close); expect(container.querySelector("pre")).toBeNull();
  await applyFilters("literal_%");
  await click(copy.exportJson); await click(copy.exportCsv); await click(copy.receipts); await click(copy.references);
  expect(downloads.map(value => value.name)).toEqual(["keryx-history.json", "keryx-history.csv", "alice-run-receipts.json", "alice-run.bib"]);
  expect(createObjectURL).toHaveBeenCalledTimes(4); expect(revokeObjectURL).toHaveBeenCalledTimes(4);
  expect(container.querySelector('[role="alert"]')).toBeNull(); expect(requests).toHaveLength(7);
  for (const request of requests) expectRead(request);
  for (const request of requests.filter(value => value.url.pathname !== "/api/me/asks")) expect(request.init.redirect).toBe("error");
  const exports = requests.filter(value => value.url.pathname === "/api/me/asks/export");
  for (const request of exports) { expect(request.url.searchParams.get("search")).toBe("literal_%"); expect(request.url.searchParams.has("cursor")).toBe(false); }
  expect(exports[1].url.searchParams.get("format")).toBe("csv");
  expect(requests.at(-2)!.url.searchParams.get("format")).toBe("receipts");
  expect(requests.at(-1)!.url.searchParams.get("format")).toBe("bibtex");
});

it("releases the object URL when the current browser download boundary fails", async () => {
  await renderPane(); const ordinary = respond;
  respond = request => isOperation(request, "export") ? Response.json({ syntheticExport: true }) : ordinary(request);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("Synthetic download denial"); });
  await click(copy.exportJson);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.failed);
  expect(createObjectURL).toHaveBeenCalledTimes(1); expect(revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-owned-history");
});

it("keeps explicit pagination bound to the list while exports omit the active cursor", async () => {
  respond = request => {
    if (isOperation(request, "export")) return Response.json({ syntheticExport: true });
    const older = request.url.searchParams.has("cursor");
    return Response.json({ ...page(alice, older ? "Older ready" : "Alice ready"), nextCursor: older ? null : "synthetic_cursor" });
  };
  await renderPane(); ready(); expect(button(copy.previous).disabled).toBe(true);
  await click(copy.next); ready("Older ready");
  expect(requests.at(-1)!.url.searchParams.get("cursor")).toBe("synthetic_cursor");
  expect(button(copy.next).disabled).toBe(true); expect(button(copy.previous).disabled).toBe(false);
  await click(copy.exportJson);
  expect(requests.at(-1)!.url.searchParams.has("cursor")).toBe(false);
  await click(copy.previous); ready();
  expect(requests.at(-1)!.url.searchParams.has("cursor")).toBe(false); expect(requests).toHaveLength(4);
});

it("keeps visibility revision/requestId/owner authority and discards a stale mutation outcome", async () => {
  await renderPane(); const waiting = deferred<Response>(), ordinary = respond;
  respond = request => request.url.pathname === "/api/me/run-privacy/alice-run" ? waiting.promise : ordinary(request);
  const select = container.querySelector<HTMLSelectElement>('article select[name="visibility"]')!;
  await act(async () => { select.value = "unlisted"; select.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  const mutation = requests.at(-1)!;
  expect(mutation.init.method).toBe("PATCH"); expect(new Headers(mutation.init.headers).get("X-Keryx-Expected-Wallet")).toBe(alice);
  expect(JSON.parse(String(mutation.init.body))).toEqual({ visibility: "unlisted", revision: 7, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  listQuestion = "New filter ready"; await applyFilters();
  await act(async () => { waiting.resolve(new Response(null, { status: 200 })); });
  ready(); expect(mutation.init.signal?.aborted).toBe(true); expect(requests).toHaveLength(3);
});

it("offers member-wallet rows as read-only without issuing a mutation or interpreting membership as spend authority", async () => {
  respond = () => Response.json({ ...page(), scope: "account-owned-current-store", membershipAvailable: true, rows: [row(bob, "Member row")] });
  await renderPane(); ready("Member row");
  expect(container.textContent).toContain(copy.memberReadOnly);
  expect(container.querySelector("article form")).toBeNull();
  expect(Array.from(container.querySelectorAll("button")).some(value => value.textContent === copy.save || value.textContent === copy.erase)).toBe(false);
  expect(requests).toHaveLength(1);
});

function watchBlobs() {
  const created = vi.fn(), NativeBlob = Blob;
  vi.stubGlobal("Blob", class extends NativeBlob {
    constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) { super(parts, options); created(parts, options); }
  });
  return created;
}
function expectNoPrivateOutput(created: ReturnType<typeof watchBlobs>) {
  expect(container.textContent).not.toContain("Stale private");
  expect(container.querySelector("pre")).toBeNull();
  expect(created).not.toHaveBeenCalled(); expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled(); expect(downloads).toEqual([]);
}
async function submitMutation(method: "PATCH" | "DELETE") {
  if (method === "DELETE") { await click(copy.erase); return; }
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('article select[name="visibility"]')!;
    expect(select).not.toBeNull(); select.value = "unlisted";
    select.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function expectMutation(request: RequestRecord, method: "PATCH" | "DELETE") {
  expect(request.url.pathname).toBe("/api/me/run-privacy/alice-run");
  expect(request.url.search).toBe(""); expect(request.init.method).toBe(method);
  const headers = new Headers(request.init.headers);
  expect(headers.get("X-Keryx-Expected-Wallet")).toBe(alice);
  expect(headers.get("Content-Type")).toBe("application/json");
  const value = JSON.parse(String(request.init.body)) as { requestId: string };
  expect(value).toEqual({ ...(method === "PATCH" ? { visibility: "unlisted" } : {}), revision: 7,
    requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) });
  return value.requestId;
}

it.each([
  ["report", "fetch", "signout"], ["report", "fetch", "switch"], ["report", "fetch", "unmount"],
  ["report", "body", "signout"], ["report", "body", "switch"], ["report", "body", "unmount"],
  ["export", "fetch", "signout"], ["export", "fetch", "switch"], ["export", "fetch", "unmount"],
  ["export", "body", "signout"], ["export", "body", "switch"], ["export", "body", "unmount"],
] as const)("ignores a rejected %s %s after owner %s without private output or replacement status writes", async (operation, stage, transition) => {
  const created = watchBlobs(); await renderPane(); ready();
  const waiting = deferred<Response>(), replacement = deferred<Response>(), body = heldBody(), ordinary = respond;
  respond = request => request.url.pathname === "/api/me/asks" && new Headers(request.init.headers).get("X-Keryx-Expected-Wallet") === bob
    ? replacement.promise : isOperation(request, operation) ? stage === "fetch" ? waiting.promise : body.response : ordinary(request);
  await click(operation === "report" ? copy.report : copy.exportJson);
  const old = requests.at(-1)!; expectRead(old); expect(old.init.signal?.aborted).toBe(false);
  if (stage === "body") {
    expect(body.response.body?.locked).toBe(true);
    // Receive private bytes before the transition, but never complete a valid body.
    await act(async () => { body.bytes(new TextEncoder().encode(operation === "report"
      ? JSON.stringify(report("Stale private answer")).slice(0, -1) : "Stale private export bytes")); });
  }
  if (transition === "unmount") await unmount();
  else { auth.session = transition === "signout" ? null : { address: bob, role: "asker" }; await renderPane(); }
  expect(old.init.signal?.aborted).toBe(true); expectNoPrivateOutput(created);
  if (transition === "switch") {
    expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.checking);
    expect(container.querySelector("article")).toBeNull(); expectRead(requests.at(-1)!, bob);
  } else expect(container.textContent).toBe(transition === "signout" ? copy.signedOut : "");
  const replacementDom = container.innerHTML, count = requests.length;
  await act(async () => { if (stage === "fetch") waiting.reject(new Error("Stale private transport diagnostic")); else body.fail(); });
  expect(container.innerHTML).toBe(replacementDom); expect(requests).toHaveLength(count);
  expect(container.querySelector('[role="alert"]')).toBeNull(); expectNoPrivateOutput(created);
  if (stage === "body") expect(body.response.body?.locked).toBe(false);
  if (transition === "switch") { await act(async () => { replacement.resolve(Response.json(page(bob, "Bob ready"))); }); ready("Bob ready"); }
  expect(requests).toHaveLength(transition === "switch" ? 3 : 2); expectNoPrivateOutput(created);
});

it.each([
  ["report", "fetch"], ["report", "body"], ["export", "fetch"], ["export", "body"],
] as const)("contains a current %s %s rejection and requires an explicit refresh and retry", async (operation, stage) => {
  const created = watchBlobs(); await renderPane();
  const waiting = deferred<Response>(), body = heldBody(), ordinary = respond;
  respond = request => isOperation(request, operation) ? stage === "fetch" ? waiting.promise : body.response : ordinary(request);
  await click(operation === "report" ? copy.report : copy.exportJson);
  const current = requests.at(-1)!; expectRead(current); expect(current.init.signal?.aborted).toBe(false);
  await act(async () => {
    if (stage === "fetch") waiting.reject(new Error("Stale private transport diagnostic"));
    else { body.bytes(new TextEncoder().encode("Stale private incomplete body")); body.fail(); }
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.failed);
  expect(container.querySelector('[role="status"]')).toBeNull(); expect(container.querySelector("h3")?.textContent).toBe("Alice ready");
  expectNoPrivateOutput(created); if (stage === "body") expect(body.response.body?.locked).toBe(false);
  await act(async () => {}); expect(requests).toHaveLength(2);
  respond = request => isOperation(request, "report") ? Response.json(report("Explicit retry answer")) :
    isOperation(request, "export") ? Response.json({ syntheticExport: true }) : ordinary(request);
  await click(copy.refresh); ready(); expect(current.init.signal?.aborted).toBe(true); expect(requests).toHaveLength(3);
  await click(operation === "report" ? copy.report : copy.exportJson); ready(); expect(requests).toHaveLength(4);
  if (operation === "report") { expect(container.querySelector("pre")?.textContent).toBe("Explicit retry answer"); expect(created).not.toHaveBeenCalled(); }
  else { expect(downloads.map(value => value.name)).toEqual(["keryx-history.json"]); expect(created).toHaveBeenCalledTimes(1); expect(revokeObjectURL).toHaveBeenCalledTimes(1); }
});

it.each([
  ["PATCH", "fetch"], ["PATCH", "refusal"], ["DELETE", "fetch"], ["DELETE", "refusal"],
] as const)("preserves current %s authority on %s failure and retries only on an explicit action", async (method, outcome) => {
  const created = watchBlobs(), confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await renderPane(); ready();
  const waiting = deferred<Response>(), refused = heldBody(), accepted = heldBody(), refreshed = deferred<Response>(), ordinary = respond;
  respond = request => request.url.pathname === "/api/me/run-privacy/alice-run" ? waiting.promise : ordinary(request);
  await submitMutation(method);
  const first = requests.at(-1)!, firstId = expectMutation(first, method);
  expect(first.init.signal?.aborted).toBe(false);
  if (method === "DELETE") expect(confirm).toHaveBeenCalledWith(copy.confirmErase); else expect(confirm).not.toHaveBeenCalled();
  await act(async () => {
    if (outcome === "fetch") waiting.reject(new Error("Stale private mutation diagnostic"));
    else waiting.resolve(new Response(refused.response.body, { status: 409 }));
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.failed);
  expect(container.querySelector("h3")?.textContent).toBe("Alice ready");
  expect(container.querySelector("article p")?.textContent).toContain("private");
  expect(first.init.signal?.aborted).toBe(false); expectNoPrivateOutput(created);
  if (outcome === "refusal") { expect(refused.cancelled).toHaveBeenCalledTimes(1); expect(refused.response.body?.locked).toBe(false); }
  await act(async () => {}); expect(requests).toHaveLength(2); // No implicit mutation replay or list refresh.
  respond = request => request.url.pathname === "/api/me/run-privacy/alice-run" ? accepted.response :
    request.url.pathname === "/api/me/asks" ? refreshed.promise : ordinary(request);
  await submitMutation(method);
  const retry = requests[2], retryId = expectMutation(retry, method);
  expect(retryId).not.toBe(firstId); expect(accepted.cancelled).toHaveBeenCalledTimes(1); expect(accepted.response.body?.locked).toBe(false);
  expect(requests).toHaveLength(4); expectRead(requests[3]); expect(retry.init.signal?.aborted).toBe(true);
  if (method === "DELETE") expect(confirm).toHaveBeenCalledTimes(2); else expect(confirm).not.toHaveBeenCalled();
  const value = page(alice, "Server confirmed history");
  if (method === "PATCH") { value.rows[0].visibility = "unlisted"; value.rows[0].revision = 8; }
  else value.rows = [];
  await act(async () => { refreshed.resolve(Response.json(value)); });
  expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('[role="status"]')).toBeNull();
  if (method === "PATCH") { ready("Server confirmed history"); expect(container.querySelector<HTMLSelectElement>('article select[name="visibility"]')?.value).toBe("unlisted"); expect(container.querySelector("article p")?.textContent).toContain("unlisted"); }
  else { expect(container.querySelector("article")).toBeNull(); expect(container.textContent).toContain(copy.empty); }
  expect(requests).toHaveLength(4); expectNoPrivateOutput(created);
});

// The original fixture already covers stale successful PATCH after a filter change.
// These are the missing rejected PATCH and successful/rejected DELETE outcomes.
const staleMutationCases = ([
  ["PATCH", "fetch"], ["PATCH", "refusal"], ["DELETE", "success"], ["DELETE", "fetch"], ["DELETE", "refusal"],
] as const).flatMap(([method, outcome]) => (["filter", "signout", "switch", "unmount"] as const)
  .map(transition => [method, outcome, transition] as const));
it.each(staleMutationCases)("ignores stale %s %s after %s without a refresh, error or private output", async (method, outcome, transition) => {
  const created = watchBlobs(), confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await renderPane(); ready();
  const waiting = deferred<Response>(), replacement = deferred<Response>(), body = heldBody(), ordinary = respond;
  respond = request => request.url.pathname === "/api/me/run-privacy/alice-run" ? waiting.promise :
    request.url.pathname === "/api/me/asks" && new Headers(request.init.headers).get("X-Keryx-Expected-Wallet") === bob ? replacement.promise : ordinary(request);
  await submitMutation(method);
  const old = requests.at(-1)!; expectMutation(old, method); expect(old.init.signal?.aborted).toBe(false);
  if (method === "DELETE") expect(confirm).toHaveBeenCalledWith(copy.confirmErase); else expect(confirm).not.toHaveBeenCalled();
  if (transition === "filter") { listQuestion = "New filter ready"; await applyFilters(); ready(); }
  else if (transition === "unmount") await unmount();
  else { auth.session = transition === "signout" ? null : { address: bob, role: "asker" }; await renderPane(); }
  expect(old.init.signal?.aborted).toBe(true);
  if (transition === "switch") { expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.checking); expectRead(requests.at(-1)!, bob); }
  else if (transition !== "filter") expect(container.textContent).toBe(transition === "signout" ? copy.signedOut : "");
  const replacementDom = container.innerHTML, count = requests.length;
  await act(async () => {
    if (outcome === "fetch") waiting.reject(new Error("Stale private mutation diagnostic"));
    else { body.bytes(new TextEncoder().encode("Stale private mutation response")); waiting.resolve(new Response(body.response.body, { status: outcome === "success" ? 200 : 409 })); }
  });
  expect(container.innerHTML).toBe(replacementDom); expect(requests).toHaveLength(count); expectNoPrivateOutput(created);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  if (outcome !== "fetch") { expect(body.cancelled).toHaveBeenCalledTimes(1); expect(body.response.body?.locked).toBe(false); }
  if (transition === "switch") { await act(async () => { replacement.resolve(Response.json(page(bob, "Bob ready"))); }); ready("Bob ready"); }
  else if (transition === "filter") ready();
  expect(requests).toHaveLength(transition === "filter" || transition === "switch" ? 3 : 2); expectNoPrivateOutput(created);
});

it("cancels DELETE at confirmation without issuing HTTP or disturbing the current private report", async () => {
  const created = watchBlobs(), confirm = vi.spyOn(window, "confirm").mockReturnValue(false), ordinary = respond;
  respond = request => isOperation(request, "report") ? Response.json(report("Current private report")) : ordinary(request);
  await renderPane(); await click(copy.report);
  expect(container.querySelector("pre")?.textContent).toBe("Current private report");
  const currentDom = container.innerHTML, current = requests.at(-1)!;
  await click(copy.erase);
  expect(confirm).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledWith(copy.confirmErase); expect(requests).toHaveLength(2);
  expect(requests.some(request => request.init.method === "DELETE")).toBe(false);
  expect(container.innerHTML).toBe(currentDom); expect(current.init.signal?.aborted).toBe(false); ready();
  expect(created).not.toHaveBeenCalled(); expect(createObjectURL).not.toHaveBeenCalled(); expect(downloads).toEqual([]);
});

it("confirms current DELETE and shows erasure only through its authoritative refreshed list", async () => {
  const created = watchBlobs(), confirm = vi.spyOn(window, "confirm").mockReturnValue(true), ordinary = respond;
  const waiting = deferred<Response>(), refreshed = deferred<Response>(), body = heldBody();
  respond = request => isOperation(request, "report") ? Response.json(report("Current private report")) :
    request.url.pathname === "/api/me/run-privacy/alice-run" ? waiting.promise : ordinary(request);
  await renderPane(); await click(copy.report); await click(copy.erase);
  const mutation = requests.at(-1)!; expectMutation(mutation, "DELETE"); expect(mutation.init.signal?.aborted).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1); expect(confirm).toHaveBeenCalledWith(copy.confirmErase);
  expect(container.querySelector("h3")?.textContent).toBe("Alice ready"); expect(container.querySelector("pre")?.textContent).toBe("Current private report");
  expect(requests).toHaveLength(3); // No optimistic erase or claimed server rollback.
  respond = request => request.url.pathname === "/api/me/asks" ? refreshed.promise : ordinary(request);
  await act(async () => { waiting.resolve(body.response); });
  expect(body.cancelled).toHaveBeenCalledTimes(1); expect(body.response.body?.locked).toBe(false);
  expect(requests).toHaveLength(4); expectRead(requests.at(-1)!); expect(mutation.init.signal?.aborted).toBe(true);
  expect(container.querySelector("article")).toBeNull(); expect(container.querySelector("pre")).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.checking); expectNoPrivateOutput(created);
  await act(async () => { refreshed.resolve(Response.json({ ...page(), rows: [] })); });
  expect(container.textContent).toContain(copy.empty); expect(container.querySelector("article")).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('[role="status"]')).toBeNull();
  expect(requests).toHaveLength(4); expectNoPrivateOutput(created);
});

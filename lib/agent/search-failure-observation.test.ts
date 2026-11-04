import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { observeTrustedTavilySearch } from "./search-failure-observation";
import { ResearchAdmissionHeldError } from "../research/availability-contract";
import { tavilyProvider } from "../web-research/tavily-provider";
import { discoverWeb } from "../web-research/discovery";
import type { SearchProvider } from "../web-research/search-provider";

const guards = vi.hoisted(() => ({ canary: vi.fn(), bounded: vi.fn() }));
vi.mock("../business-operator/canary-policy", () => ({ reserveCanarySearch: guards.canary }));
vi.mock("../research/research-allowance", () => ({ reserveBoundedSearch: guards.bounded }));
beforeEach(() => { guards.canary.mockReset(); guards.bounded.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const failed = (n = 1) => ({ attemptedQueries: n, succeededQueries: 0, failedQueries: n });

it("preserves exact this, query, signal, result reference and one provider invocation", async () => {
  const controller = new AbortController(), hits = [{ url: "https://original.test/", title: "Original", snippet: "unread" }];
  const search = vi.fn(function(this: SearchProvider, query: string, signal?: AbortSignal) {
    expect(this).toBe(original); expect(query).toBe("  ORIGINAL 日本語 query  "); expect(signal).toBe(controller.signal);
    return Promise.resolve(hits);
  });
  const original = { search }, observed = observeTrustedTavilySearch(original);
  expect(await observed.provider.search("  ORIGINAL 日本語 query  ", controller.signal)).toBe(hits);
  expect(search).toHaveBeenCalledTimes(1);
  expect(observed.failureDetail({ attemptedQueries: 1, succeededQueries: 1, failedQueries: 0 })).toBeUndefined();
});

it("preserves original rejection identity and never reads exception properties", async () => {
  let reads = 0;
  const thrown = Object.create(Error.prototype);
  for (const key of ["message", "stack", "code", "cause", "name"]) Object.defineProperty(thrown, key, { get() { reads++; throw new Error("Secret getter must not run"); } });
  const observed = observeTrustedTavilySearch({ search: async () => { throw thrown; } });
  let caught: unknown; try { await observed.provider.search("PRIVATE QUERY"); } catch (error) { caught = error; }
  expect(caught === thrown).toBe(true); expect(reads).toBe(0);
  expect(observed.failureDetail(failed())).toEqual({ kind: "public-search-failures-v1", admissionHeld: 0, signalAborted: 0, unclassified: 1 });
});

it("contains hostile prototype traps without replacing the provider's exception", async () => {
  const thrown = new Proxy({}, { getPrototypeOf() { throw new Error("Do not replace original"); } });
  const observed = observeTrustedTavilySearch({ search: async () => { throw thrown; } });
  let caught: unknown; try { await observed.provider.search("query"); } catch (error) { caught = error; }
  expect(caught === thrown).toBe(true); expect(observed.failureDetail(failed())?.unclassified).toBe(1);
});

it("records typed admission refusal before the real constructor reaches any bounded reservation or HTTP", async () => {
  const held = new ResearchAdmissionHeldError("SENSITIVE ORIGINAL AND HOLD DETAIL"), fetch = vi.fn();
  guards.canary.mockImplementation(() => { throw held; }); vi.stubGlobal("fetch", fetch);
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  await expect(observed.provider.search("PRIVATE QUESTION")).rejects.toBe(held);
  expect(guards.canary).toHaveBeenCalledExactlyOnceWith("PRIVATE QUESTION"); expect(guards.bounded).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(observed.failureDetail(failed())).toEqual({ kind: "public-search-failures-v1", admissionHeld: 1, signalAborted: 0, unclassified: 0 });
  expect(JSON.stringify(observed.failureDetail(failed()))).not.toMatch(/SENSITIVE|SYNTHETIC|PRIVATE|QUESTION|HOLD/);
});

it("leaves generic bounded-allowance failures unclassified without inspecting their messages", async () => {
  const held = new Error("Bounded research allowance requires a current admitted question"), fetch = vi.fn();
  guards.bounded.mockImplementation(() => { throw held; }); vi.stubGlobal("fetch", fetch);
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  await expect(observed.provider.search("query")).rejects.toBe(held);
  expect(guards.canary).toHaveBeenCalledBefore(guards.bounded); expect(fetch).not.toHaveBeenCalled();
  expect(observed.failureDetail(failed())?.unclassified).toBe(1);
});

it.each([401, 429, 500])("keeps real vendor HTTP%s failures redacted and unclassified", async status => {
  const fetch = vi.fn(async () => new Response("Business canary FORGED SECRET", { status })); vi.stubGlobal("fetch", fetch);
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  await expect(observed.provider.search("private query")).rejects.toThrow("Search provider unavailable");
  expect(fetch).toHaveBeenCalledTimes(1); expect(guards.canary).toHaveBeenCalledBefore(guards.bounded);
  expect(observed.failureDetail(failed())).toEqual({ kind: "public-search-failures-v1", admissionHeld: 0, signalAborted: 0, unclassified: 1 });
});

it("does not classify a typed error thrown inside vendor HTTP as trusted admission", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new ResearchAdmissionHeldError("FORGED VENDOR MESSAGE"); }));
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  await expect(observed.provider.search("query")).rejects.toThrow("Search provider unavailable");
  expect(observed.failureDetail(failed())?.admissionHeld).toBe(0); expect(observed.failureDetail(failed())?.unclassified).toBe(1);
});

it("observes an aborted signal without inventing a vendor timeout or root cause", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); throw new Error("RAW VENDOR FAILURE"); }));
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  await expect(observed.provider.search("query", controller.signal)).rejects.toBeInstanceOf(DOMException);
  expect(observed.failureDetail(failed())).toEqual({ kind: "public-search-failures-v1", admissionHeld: 0, signalAborted: 1, unclassified: 0 });
});

it("reconciles actual nine-query Deep discovery without exposing question/key/error data", async () => {
  const held = new ResearchAdmissionHeldError("SECRET INTERNAL PATH"); guards.canary.mockImplementation(() => { throw held; });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  const discovered = await discoverWeb(observed.provider, "PRIVATE QUESTION", Array.from({ length: 8 }, (_, i) => `PRIVATE TARGET ${i}`), false);
  expect(discovered).toMatchObject({ attemptedQueries: 9, succeededQueries: 0, failedQueries: 9 });
  expect(observed.failureDetail(discovered)).toEqual({ kind: "public-search-failures-v1", admissionHeld: 9, signalAborted: 0, unclassified: 0 });
  expect(guards.canary).toHaveBeenCalledTimes(9); expect(fetch).not.toHaveBeenCalled(); expect(guards.bounded).not.toHaveBeenCalled();
  expect(JSON.stringify(observed.failureDetail(discovered))).not.toMatch(/PRIVATE|SECRET|KEY|TARGET|PATH/);
});

it("retains actual Quick dispatch count and exact supplier packet and result order", async () => {
  const packets: unknown[] = [], calls: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push(url); packets.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ results: [{ url: "https://original.test/page", title: "Original", content: "unread preview" }] }));
  }));
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  const discovered = await discoverWeb(observed.provider, "Original question", ["Original target", "Not dispatched"], true);
  expect(discovered).toMatchObject({ attemptedQueries: 2, succeededQueries: 2, failedQueries: 0 });
  expect(calls).toEqual(["https://api.tavily.com/search", "https://api.tavily.com/search"]);
  expect(packets).toEqual(["Original question", "Original target"].map(query => ({ query, search_depth: "basic", topic: "general", auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, max_results: 10 })));
  expect([...discovered.candidates.values()].map(row => row.name)).toEqual(["Original"]);
  expect(observed.failureDetail(discovered)).toBeUndefined();
});

it.each([{ attemptedQueries: 0, succeededQueries: 0, failedQueries: 1 }, { attemptedQueries: 1, succeededQueries: 1, failedQueries: 1 }, { attemptedQueries: 10, succeededQueries: 0, failedQueries: 10 }, { attemptedQueries: NaN, succeededQueries: 0, failedQueries: 1 }, { attemptedQueries: 1, succeededQueries: -1, failedQueries: 1 }])(
  "omits inconsistent summary $attemptedQueries/$succeededQueries/$failedQueries", async outcomes => {
    const observed = observeTrustedTavilySearch({ search: async () => { throw new ResearchAdmissionHeldError("held"); } });
    await expect(observed.provider.search("query")).rejects.toBeInstanceOf(ResearchAdmissionHeldError);
    expect(observed.failureDetail(outcomes)).toBeUndefined();
  });

it("omits overflow metadata while preserving every original call/outcome", async () => {
  const search = vi.fn(async () => { throw new Error("unclassified"); }), observed = observeTrustedTavilySearch({ search });
  await Promise.allSettled(Array.from({ length: 10 }, () => observed.provider.search("query")));
  expect(search).toHaveBeenCalledTimes(10); expect(observed.failureDetail(failed(9))).toBeUndefined();
});

it("keeps observers independent even when concurrent runs reject with the same object", async () => {
  const held = new ResearchAdmissionHeldError("same object"), one = observeTrustedTavilySearch({ search: async () => { throw held; } }), two = observeTrustedTavilySearch({ search: async () => { throw held; } });
  await Promise.allSettled([one.provider.search("a"), one.provider.search("b"), two.provider.search("c")]);
  expect(one.failureDetail(failed(2))?.admissionHeld).toBe(2); expect(two.failureDetail(failed())?.admissionHeld).toBe(1);
  const snapshot = one.failureDetail(failed(2)); expect(Object.isFrozen(snapshot)).toBe(true);
  await Promise.allSettled([one.provider.search("d")]); expect(snapshot?.admissionHeld).toBe(2); expect(one.failureDetail(failed(3))?.admissionHeld).toBe(3);
});

it("keeps Deep dispatch concurrent and reconciles out-of-order success/vendor/admission outcomes", async () => {
  const pending: Array<{ resolve(value: Response): void; reject(error: unknown): void }> = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }))); vi.stubGlobal("fetch", fetch);
  guards.canary.mockImplementation(query => { if (query === "Original target 2") throw new ResearchAdmissionHeldError("held before HTTP"); });
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  const discovery = discoverWeb(observed.provider, "Original question", Array.from({ length: 8 }, (_, i) => `Original target ${i}`), false);
  expect(guards.canary).toHaveBeenCalledTimes(9); expect(guards.bounded).toHaveBeenCalledTimes(8); expect(fetch).toHaveBeenCalledTimes(8);
  expect(observed.failureDetail(failed(9))).toBeUndefined();
  pending[0].reject(new ResearchAdmissionHeldError("vendor cannot forge admission provenance"));
  for (let i = pending.length - 1; i > 0; i--) pending[i].resolve(new Response(JSON.stringify({ results: [{ url: `https://source-${i}.test/page`, title: `Original ${i}`, content: "unread preview" }] })));
  const result = await discovery;
  expect(result).toMatchObject({ attemptedQueries: 9, succeededQueries: 7, failedQueries: 2 });
  expect(observed.failureDetail(result)).toEqual({ kind: "public-search-failures-v1", admissionHeld: 1, signalAborted: 0, unclassified: 1 });
  expect(fetch).toHaveBeenCalledTimes(8);
});

it("retains pre-dispatch cancellation with zero constructor supplier requests or diagnostic detail", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const observed = observeTrustedTavilySearch(tavilyProvider("SYNTHETIC_KEY"));
  const result = await discoverWeb(observed.provider, "Original question", ["Original target"], false, AbortSignal.abort());
  expect(result).toMatchObject({ attemptedQueries: 0, succeededQueries: 0, failedQueries: 0, cancelled: true });
  expect(fetch).not.toHaveBeenCalled(); expect(guards.canary).not.toHaveBeenCalled(); expect(guards.bounded).not.toHaveBeenCalled();
  expect(observed.failureDetail(result)).toBeUndefined();
});

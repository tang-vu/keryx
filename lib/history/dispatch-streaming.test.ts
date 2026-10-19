import { PassThrough } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import type { PrivacyActor, PrivacyList } from "../run-privacy/contracts";

const fixture = vi.hoisted(() => ({ db: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: fixture.db }));
vi.mock("@/lib/run-privacy/auth", () => ({ pagePrivacyActor: fixture.actor }));
vi.mock("@/lib/history/testnet-archive", () => ({ getTestnetArchive: vi.fn(() => { throw Error("No historical fallback"); }) }));
vi.mock("@/lib/answers-freshness", () => ({ loadFreshness: async () => null }));
vi.mock("@/app/dispatch/[id]/dispatch-view", () => ({ DispatchView: ({ run }: { run: QueryRun }) => createElement("article", null, run.question, run.answer) }));
vi.mock("@/components/keryx/follow-up-form", () => ({ FollowUpForm: () => null }));
vi.mock("@/components/keryx/portable-receipt-panel", () => ({ PortableReceiptPanel: () => null }));
vi.mock("@/components/keryx/purchase-outcomes", () => ({ PurchaseOutcomesPanel: () => null }));
vi.mock("@/components/keryx/deliverable-acceptance", () => ({ DeliverableAcceptance: () => null }));

import DispatchPage from "@/app/dispatch/[id]/page";

const owner = `0x${"a".repeat(40)}`;
const actor: PrivacyActor = { wallet: owner, binding: { origin: "https://synthetic.example", network: "eip155:5042002" } };
function run(id: string): QueryRun {
  return { id, question: `SQLite research ${id}?`, answer: `Retained answer ${id}.`, createdAt: "2026-10-19T00:00:00.000Z",
    budget: 0, engine: "synthetic", totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], trace: [],
    citations: [{ marker: "S1", sourceId: "sqlite", sourceName: "SQLite", weight: 1, reward: 0, rationale: "Synthetic excerpt" }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function install(options: { private?: boolean; hidden?: boolean; revoke?: boolean; fresh?: boolean } = {}) {
  const current = run("current"), related = run("related"), hidden = run("hidden-private"), unlisted = run("hidden-unlisted");
  const entered = deferred<void>(), archive = deferred<void>();
  let revoked = false;
  const list = vi.fn(async (query: PrivacyList) => {
    if (!query.ids && !query.before) { entered.resolve(); await archive.promise; }
    // This fixture mirrors the port's storage-side public/unerased filter. The
    // real archive selector and its separate fresh-publication pass stay active.
    if (query.ids) return revoked ? [] : [{ ...related, question: options.fresh ? "SQLite fresh public title?" : related.question }];
    if (query.before) return [];
    if (options.revoke) revoked = true;
    return [related];
  });
  const read = vi.fn(async (_id: string, reader?: PrivacyActor) => ({ exists: true,
    item: options.hidden || options.private && reader?.wallet !== owner ? null : {
      run: current, state: { visibility: options.private ? "private" : "public", revision: 0, erased: false },
    } }));
  const legacy = vi.fn(() => { throw Error("Original enumeration forbidden"); });
  fixture.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: { read, list }, iterateRecentQueries: legacy,
    listCreatorPaymentAttemptsByQuery: async () => [], listFollowUps: async () => [] });
  fixture.actor.mockResolvedValue(options.private ? actor : undefined);
  return { current, related, hidden, unlisted, entered, archive, list, read, legacy };
}
function streamPage() {
  let html = "";
  const sink = new PassThrough(), errors: unknown[] = [], completed = deferred<void>();
  sink.on("data", chunk => { html += chunk.toString(); });
  sink.on("end", () => completed.resolve());
  const stream = renderToPipeableStream(createElement(DispatchPage, { params: Promise.resolve({ id: "current" }) }), {
    onShellReady() { stream.pipe(sink); }, onError(error) { errors.push(error); }, onShellError(error) { completed.reject(error as Error); },
  });
  return { html: () => html, completed: completed.promise, errors, abort: () => stream.abort() };
}
beforeEach(() => { vi.clearAllMocks(); });

it.each([false, true])("streams an authorized report before stalled related links, private=%s", async privateReport => {
  const f = install({ private: privateReport, fresh: true }), output = streamPage();
  try {
    await f.entered.promise;
    await vi.waitFor(() => expect(output.html()).toContain(f.current.answer), { timeout: 500 });
    expect(output.html()).not.toContain(f.related.question);
    expect(f.read).toHaveBeenCalledWith("current", privateReport ? actor : undefined);
    f.archive.resolve(); await output.completed;
    expect(output.html()).toContain("SQLite fresh public title?");
    expect(output.html()).not.toContain(f.related.question);
    expect(output.html()).not.toContain(f.hidden.question);
    expect(output.html()).not.toContain(f.unlisted.question);
    expect(f.list.mock.calls.some(([query]) => query.ids?.includes("related"))).toBe(true);
    expect(f.legacy).not.toHaveBeenCalled(); expect(output.errors).toEqual([]);
  } finally { f.archive.resolve(); await output.completed.catch(() => {}); output.abort(); }
});

it("keeps the streamed report when related discovery refuses, without legacy fallback", async () => {
  const f = install(), output = streamPage();
  try {
    await f.entered.promise;
    await vi.waitFor(() => expect(output.html()).toContain(f.current.answer), { timeout: 500 });
    f.archive.reject(new Error("Synthetic private storage detail")); await output.completed;
    expect(output.html()).toContain(f.current.answer);
    expect(output.html()).not.toContain("Synthetic private storage detail");
    expect(output.html()).not.toContain(f.related.question);
    expect(f.legacy).not.toHaveBeenCalled(); expect(output.errors).toEqual([]);
  } finally { f.archive.resolve(); await output.completed.catch(() => {}); output.abort(); }
});

it("does not stream an early related winner revoked before publication", async () => {
  const f = install({ revoke: true }), output = streamPage();
  try {
    await f.entered.promise;
    await vi.waitFor(() => expect(output.html()).toContain(f.current.answer), { timeout: 500 });
    f.archive.resolve(); await output.completed;
    expect(output.html()).not.toContain(f.related.question);
    expect(f.list.mock.calls.some(([query]) => query.ids?.includes("related"))).toBe(true);
    expect(output.errors).toEqual([]);
  } finally { f.archive.resolve(); await output.completed.catch(() => {}); output.abort(); }
});

it("keeps hidden primary reports behind the original visibility check", async () => {
  const f = install({ hidden: true });
  await expect(DispatchPage({ params: Promise.resolve({ id: "current" }) })).rejects.toThrow();
  expect(f.list).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
});

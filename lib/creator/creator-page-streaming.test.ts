import { PassThrough } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { createMessages } from "../i18n/messages";
import type { QueryRun, Source } from "../types";

const fixture = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: fixture.db }));
vi.mock("@/app/creator/[id]/creator-detail-view", () => ({
  CreatorDetailView: ({ creatorId }: { creatorId: string }) => createElement("article", null, `Ready creator profile: ${creatorId}`),
}));

import CreatorPage, { generateMetadata } from "@/app/creator/[id]/page";

const copy = createMessages("en"), id = "source-a";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function install(privateCandidate = false) {
  const entered = deferred<void>(), gate = deferred<void>();
  const source: Source = { id, name: "Public creator", description: "Public description", url: "https://creator.example",
    walletAddress: `0x${"ab".repeat(20)}`, fetchPrice: 0.001, tags: ["research"], authors: [], createdAt: "2026-10-01T00:00:00.000Z" };
  const candidate: QueryRun = { id: "retained-run", question: "PRIVATE_RAW_REQUEST", answer: "PRIVATE_RAW_ANSWER",
    createdAt: "2026-10-01T00:00:00.000Z", budget: 0, engine: "synthetic", totalSpent: 0, totalToCreators: 0,
    decisions: [{ sourceId: id, sourceName: source.name, action: "SKIP", price: 0, confidence: 0, rationale: "Synthetic", expectedValue: 0, targets: [] }],
    subClaims: [], citations: [], trace: [] };
  const privacy = { list: vi.fn(async () => []), read: vi.fn(async () => ({ exists: true,
    item: { run: candidate, state: { visibility: "private", revision: 1, erased: false } } })) };
  const iterate = vi.fn(async function* (limit: number) {
    expect(limit).toBe(300); entered.resolve(); await gate.promise;
    if (privateCandidate) yield candidate;
  });
  const getSource = vi.fn(async (): Promise<Source | null> => source);
  fixture.db.mockResolvedValue({ getSource, runPrivacyActive: true, runPrivacy: privacy, iterateRecentQueries: iterate });
  return { entered, gate, privacy, iterate, getSource };
}
function streamPage() {
  let html = "";
  const sink = new PassThrough(), errors: unknown[] = [], completed = deferred<void>();
  sink.on("data", chunk => { html += chunk.toString(); });
  sink.on("end", () => completed.resolve());
  const stream = renderToPipeableStream(createElement(CreatorPage, { params: Promise.resolve({ id }) }), {
    onShellReady() { stream.pipe(sink); }, onError(error) { errors.push(error); },
    onShellError(error) { completed.reject(error as Error); },
  });
  return { html: () => html, completed: completed.promise, errors, abort: () => stream.abort() };
}
beforeEach(() => { vi.clearAllMocks(); });

it("streams the creator profile while the actual bounded learning reader is unresolved", async () => {
  const f = install(), output = streamPage();
  try {
    await f.entered.promise;
    await vi.waitFor(() => expect(output.html()).toContain(`Ready creator profile: ${id}`), { timeout: 500 });
    expect(output.html()).toContain(copy("sourceLearning.title"));
    expect(output.html()).toContain('aria-busy="true"');
    expect(output.html()).not.toContain(copy("sourceLearning.unavailable"));
    expect(output.html()).not.toContain(copy("sourceLearning.empty"));
    f.gate.resolve(); await output.completed;
    expect(output.html()).toContain(copy("sourceLearning.empty"));
    expect(f.privacy.list).toHaveBeenCalledWith({ take: 1, ids: [] });
    expect(f.iterate).toHaveBeenCalledOnce();
    expect(output.errors).toEqual([]);
  } finally { f.gate.resolve(); await output.completed.catch(() => {}); output.abort(); }
});

it("keeps the streamed profile and truthful unavailable state when learning refuses", async () => {
  const f = install(), output = streamPage();
  try {
    await f.entered.promise;
    await vi.waitFor(() => expect(output.html()).toContain(`Ready creator profile: ${id}`), { timeout: 500 });
    f.gate.reject(new Error("PRIVATE_STORE_TOKEN")); await output.completed;
    expect(output.html()).toContain(`Ready creator profile: ${id}`);
    expect(output.html()).toContain(copy("sourceLearning.unavailable"));
    expect(output.html()).not.toContain(copy("sourceLearning.empty"));
    expect(output.html()).not.toContain("PRIVATE_STORE_TOKEN");
    expect(output.errors).toEqual([]);
  } finally { f.gate.resolve(); await output.completed.catch(() => {}); output.abort(); }
});

it("preserves the actual reader's fresh private-row exclusion after the shell streams", async () => {
  const f = install(true), output = streamPage();
  try {
    await f.entered.promise; f.gate.resolve(); await output.completed;
    expect(f.privacy.read).toHaveBeenCalledWith("retained-run");
    expect(output.html()).toContain(copy("sourceLearning.empty"));
    for (const secret of ["PRIVATE_RAW_REQUEST", "PRIVATE_RAW_ANSWER", "retained-run"])
      expect(output.html()).not.toContain(secret);
    expect(output.errors).toEqual([]);
  } finally { f.gate.resolve(); await output.completed.catch(() => {}); output.abort(); }
});

it("keeps missing creator pages behind the primary lookup before starting analytics", async () => {
  const f = install(); f.getSource.mockResolvedValue(null);
  await expect(CreatorPage({ params: Promise.resolve({ id }) })).rejects.toThrow("404");
  expect(f.privacy.list).not.toHaveBeenCalled(); expect(f.iterate).not.toHaveBeenCalled();
});

it("retains missing-source metadata without starting analytics", async () => {
  const f = install(); f.getSource.mockResolvedValue(null);
  expect(await generateMetadata({ params: Promise.resolve({ id }) })).toMatchObject({ robots: { index: false } });
  expect(f.privacy.list).not.toHaveBeenCalled(); expect(f.iterate).not.toHaveBeenCalled();
});

it("does not turn primary database failure into an empty creator profile", async () => {
  fixture.db.mockRejectedValue(new Error("db_unavailable"));
  await expect(CreatorPage({ params: Promise.resolve({ id }) })).rejects.toThrow("db_unavailable");
});

import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { createCurrentTopicWatchMetadata } from "./topic-watch-discovery";
import { createTopicWatch, runTopicWatchCheck, controlTopicWatch, type TopicWatchDependencies, type TopicWatchMetadataRequest, type TopicWatchState } from "./topic-watches";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const request = (): TopicWatchMetadataRequest => ({ scope: "metadata-only", key: { ownerWallet: `0x${"a".repeat(40)}`, watchId: "watch-one" },
  checkId: "c".repeat(64), question: "PRIVATE QUESTION MUST NOT LEAVE", keywords: ["transformer"], authors: [], venues: [],
  maximumRows: 32, deadlineAtMs: Date.now() + 10_000 });
const work = (suffix = "one") => ({ DOI: `10.5555/synthetic-${suffix}`, title: [`Synthetic transformer ${suffix}`],
  author: [{ given: "Test", family: "Author" }], published: { "date-parts": [[2026, 11, 3]] },
  type: "journal-article", "container-title": ["Synthetic Journal"] });
const page = (items: unknown[]) => JSON.stringify({ status: "ok", message: { items } });

it("makes one bounded latest-indexed official metadata request with only the selected keywords", async () => {
  const fetcher = vi.fn(async (_url: string, _signal?: AbortSignal) => page([work()]));
  const input = request();
  const result = await createCurrentTopicWatchMetadata(fetcher).read(input) as { rows: { record: { doi: string; repository: string } }[] };
  expect(fetcher).toHaveBeenCalledOnce();
  const [raw, signal] = fetcher.mock.calls[0], url = new URL(raw);
  expect(url.origin + url.pathname).toBe("https://api.crossref.org/works");
  expect(Object.fromEntries(url.searchParams)).toEqual({ "query.bibliographic": "transformer", sort: "indexed", order: "desc", rows: "6" });
  expect(raw).not.toContain(input.question); expect(raw).not.toContain(input.key.ownerWallet); expect(raw).not.toContain(input.key.watchId);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(result.rows[0].record).toMatchObject({ doi: "10.5555/synthetic-one", repository: "crossref" });
});

it("has no paid, model, research-body or generic search module in its runtime import graph", async () => {
  const bundle = await build({ entryPoints: ["lib/research/topic-watch-discovery.ts"], bundle: true, platform: "node", packages: "external", write: false, metafile: true });
  const inputs = Object.keys(bundle.metafile!.inputs).map(value => value.replaceAll("\\", "/"));
  expect(inputs.some(value => /lib\/(?:payments|gateway|llm)\/|x402|web-research\/article|papers\/search/u.test(value))).toBe(false);
  expect(inputs).toContain("lib/scholarly/provider.ts");
});

it("refuses aborted, expired and over-limit requests before acquisition", async () => {
  const fetcher = vi.fn(async () => page([])), adapter = createCurrentTopicWatchMetadata(fetcher);
  for (const input of [{ ...request(), maximumRows: 33 }, { ...request(), maximumRows: 0 },
    { ...request(), deadlineAtMs: Date.now() }, { ...request(), keywords: [] }]) await expect(adapter.read(input)).rejects.toThrow();
  await expect(adapter.read(request(), AbortSignal.abort())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["{}", page([work(), work("two")]), "x".repeat(250_001), page([work()]).replace('"ok"', '"error"')])(
  "refuses invalid, oversized and overfull provider pages without retry", async text => {
    const fetcher = vi.fn(async () => text);
    await expect(createCurrentTopicWatchMetadata(fetcher).read({ ...request(), maximumRows: 1 })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

it("counts unusable metadata rows without inventing a valid record or empty page", async () => {
  const fetcher = vi.fn(async () => page([{ title: ["Missing DOI"] }]));
  expect(await createCurrentTopicWatchMetadata(fetcher).read(request())).toMatchObject({ status: "available", complete: true,
    rows: [{ state: "unknown", reason: "incomplete-metadata" }] });
});

it("terminates on cancellation even when a provider ignores its signal", async () => {
  let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  const fetcher = vi.fn(async () => { enter(); return await new Promise<string>(() => {}); });
  const controller = new AbortController(), reading = createCurrentTopicWatchMetadata(fetcher).read(request(), controller.signal);
  await entered; controller.abort();
  await expect(reading).rejects.toThrow("Metadata check ended"); expect(fetcher).toHaveBeenCalledOnce();
});

it("enforces its own remaining deadline for a stalled provider", async () => {
  const fetcher = vi.fn(async () => await new Promise<string>(() => {}));
  await expect(createCurrentTopicWatchMetadata(fetcher).read({ ...request(), deadlineAtMs: Date.now() + 500 })).rejects.toThrow("Metadata check ended");
  expect(fetcher).toHaveBeenCalledOnce();
});

function fixture(fetcher: (url: string, signal?: AbortSignal) => Promise<string>) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
  let state: TopicWatchState | null = null;
  const input = request(), key = input.key;
  const deps: TopicWatchDependencies = { now: Date.now, isOwnerCurrent: owner => owner === key.ownerWallet,
    metadata: createCurrentTopicWatchMetadata(fetcher), store: { read: async () => structuredClone(state),
      compareAndSwap: async (_key, revision, next, deadline) => {
        if ((state?.revision ?? null) !== revision || Date.now() >= deadline) return false;
        state = structuredClone(next); return true;
      } } };
  const spec = { watchId: key.watchId, question: input.question, keywords: [...input.keywords], authors: [], venues: [],
    cadenceMs: 60_000, periodMs: 86_400_000, maximumChecksPerPeriod: 4, maximumRowsPerCheck: 32, maximumDigestItems: 16,
    expiresAtMs: Date.now() + 86_400_000, requestedCaps: { perCheckMicroUsdc: 0, perPeriodMicroUsdc: 0 },
    consent: { manualMetadata: true, emptyHeartbeat: true } };
  return { deps, key, create: () => createTopicWatch(deps, key.ownerWallet, spec), state: () => state!,
    advance: () => vi.setSystemTime(Date.now() + 60_000) };
}

it("discovers records outside the curated catalog and retains the exact watermark across refreshes", async () => {
  let items = [work()]; const fetcher = vi.fn(async () => page(items)), f = fixture(fetcher);
  expect((await f.create()).status).toBe("created");
  expect(await runTopicWatchCheck(f.deps, f.key)).toMatchObject({ status: "completed", paidRequests: 0, counts: { newMatches: 1 } });
  expect(f.state().watermark).toHaveLength(1);
  f.advance();
  expect(await runTopicWatchCheck(f.deps, f.key)).toMatchObject({ status: "unchanged", paidRequests: 0, counts: { newMatches: 0 } });
  expect(f.state().watermark).toHaveLength(1);
  items = [work("two"), work()]; f.advance();
  expect(await runTopicWatchCheck(f.deps, f.key)).toMatchObject({ status: "completed", counts: { newMatches: 1 } });
  expect(f.state().watermark).toHaveLength(2); expect(fetcher).toHaveBeenCalledTimes(3);
});

it("retains a failed attempt and leaves its watermark unchanged on provider refusal", async () => {
  const fetcher = vi.fn(async () => { throw new Error("Synthetic HTTP 402/refusal; no payment capability"); }), f = fixture(fetcher);
  await f.create(); const result = await runTopicWatchCheck(f.deps, f.key);
  expect(result.status).toBe("failed"); expect(result.paidRequests).toBe(0); expect(f.state().watermark).toHaveLength(0);
  expect(f.state().period.attempts).toBe(1); expect(fetcher).toHaveBeenCalledOnce();
});

it("refuses overlapping checks and cannot advance the watermark after pause during acquisition", async () => {
  let release!: (text: string) => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const fetcher = vi.fn(async () => { enter(); return await new Promise<string>(resolve => { release = resolve; }); }), f = fixture(fetcher);
  await f.create(); const checking = runTopicWatchCheck(f.deps, f.key); await entered;
  expect((await runTopicWatchCheck(f.deps, f.key)).status).toBe("overlap");
  await controlTopicWatch(f.deps, f.key, "paused"); release(page([work()]));
  expect((await checking).status).not.toBe("completed");
  expect(f.state().status).toBe("paused"); expect(f.state().watermark).toHaveLength(0); expect(fetcher).toHaveBeenCalledOnce();
});

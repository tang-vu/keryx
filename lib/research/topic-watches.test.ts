import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createTopicWatch, controlTopicWatch, runTopicWatchCheck, updateTopicWatch,
  type TopicWatchDependencies, type TopicWatchKey, type TopicWatchMetadataRequest,
  type TopicWatchSpec, type TopicWatchState, type TopicWatchStore } from "./topic-watches";
import type { PaperRecord } from "../papers/types";

// Source fixtures only: no DB, network, SDK, credentials, funding or schedule.
const A = `0x${"a".repeat(40)}`, B = `0x${"b".repeat(40)}`;
const START = 1_800_000_000_000, MINUTE = 60_000;
const key: TopicWatchKey = { ownerWallet: A, watchId: "battery-watch" };
const spec = (changes: Partial<TopicWatchSpec> = {}): TopicWatchSpec => ({
  watchId: key.watchId, question: "Which battery metadata titles are new?",
  keywords: ["battery"], authors: [], venues: [], cadenceMs: MINUTE,
  periodMs: 10 * MINUTE, maximumChecksPerPeriod: 10, maximumRowsPerCheck: 32,
  maximumDigestItems: 16, expiresAtMs: START + 24 * 60 * MINUTE,
  requestedCaps: { perCheckMicroUsdc: 5000, perPeriodMicroUsdc: 50000 },
  consent: { manualMetadata: true, emptyHeartbeat: false }, ...changes,
});
const paper = (changes: Partial<PaperRecord> = {}): PaperRecord => ({
  title: "Battery durability observations", authors: ["Ada Example"], authorCount: 1,
  authorsTruncated: false, venue: "Example Journal", doi: "10.5555/battery",
  repository: "crossref", url: "https://doi.org/10.5555/battery",
  metadataUrl: "https://api.crossref.org/works/10.5555/battery",
  metadataObservedAt: new Date(START).toISOString(), publicationKind: "journal-article",
  peerReview: "unknown", ...changes,
});
const numberedPaper = (index: number) => paper({ doi: `10.5555/battery-${index}`,
  url: `https://doi.org/10.5555/battery-${index}`, metadataUrl: `https://api.crossref.org/works/10.5555/battery-${index}` });
const batch = (...records: PaperRecord[]) => ({ version: 1, scope: "metadata-only",
  complete: true, status: records.length ? "available" : "empty",
  rows: records.map(record => ({ state: "observed", record })) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Real isolated atomic CAS: the comparison, trusted deadline check and write
 * have no await between them. Gates sit before/after that critical section.
 * This does not claim durable store or funded concurrency acceptance. */
class FixtureStore implements TopicWatchStore {
  readonly rows = new Map<string, TopicWatchState>();
  reads = 0;
  writes = 0;
  beforeRead?: (key: Readonly<TopicWatchKey>, ordinal: number) => Promise<void>;
  beforeSwap?: (next: Readonly<TopicWatchState>) => Promise<void>;
  commitThenThrow = false;
  foreignRead: TopicWatchState | null = null;
  constructor(private readonly now: () => number) {}
  private namespace(key: Readonly<TopicWatchKey>) { return `${key.ownerWallet}/${key.watchId}`; }
  snapshot(key: TopicWatchKey = { ownerWallet: A, watchId: "battery-watch" }) {
    return structuredClone(this.rows.get(this.namespace(key))!);
  }
  async read(key: Readonly<TopicWatchKey>): Promise<unknown | null> {
    const ordinal = ++this.reads;
    if (this.beforeRead) await this.beforeRead(key, ordinal);
    // Snapshot after the gate, never a snapshot captured before an awaited control.
    return this.foreignRead ? structuredClone(this.foreignRead)
      : this.rows.has(this.namespace(key)) ? this.snapshot(key) : null;
  }
  async compareAndSwap(key: Readonly<TopicWatchKey>, expectedRevision: number | null,
    next: Readonly<TopicWatchState>, notAfterMs: number): Promise<boolean> {
    if (this.beforeSwap) await this.beforeSwap(next);
    const namespace = this.namespace(key), existing = this.rows.get(namespace);
    if ((existing?.revision ?? null) !== expectedRevision || this.now() >= notAfterMs ||
      next.key.ownerWallet !== key.ownerWallet || next.key.watchId !== key.watchId ||
      next.revision !== (expectedRevision ?? 0) + 1) return false;
    this.rows.set(namespace, structuredClone(next)); this.writes++;
    if (this.commitThenThrow) { this.commitThenThrow = false; throw new Error("unknown acknowledgement"); }
    return true;
  }
}
function fixture(ownerWallet = A) {
  let now = START, currentOwner: string | null = ownerWallet, authorityGeneration = 0;
  const store = new FixtureStore(() => now);
  const read = vi.fn(async (_request: TopicWatchMetadataRequest, _signal?: AbortSignal): Promise<unknown> => batch(paper()));
  const deps: TopicWatchDependencies = { store, metadata: { read }, now: () => now,
    isOwnerCurrent: exact => exact === ownerWallet && currentOwner === exact && authorityGeneration === 0 };
  // Extra application capabilities are tripwires, not watch dependencies.
  const paid = vi.fn(() => { throw new Error("paid capability reached"); });
  for (const field of ["pay", "payFetch", "payCitation", "provider", "model", "wallet", "signedGrant"])
    Object.defineProperty(deps, field, { get: paid });
  return { deps, store, read, paid, time: (value: number) => { now = value; },
    owner: (value: string | null) => { currentOwner = value; },
    replaceOwnerSession: () => { authorityGeneration++; } };
}
async function opened(input = spec()) {
  const f = fixture();
  expect(await createTopicWatch(f.deps, A, input)).toMatchObject({ status: "created", paidRequests: 0, standingSpend: "withheld" });
  return f;
}
function gateMetadata(f: ReturnType<typeof fixture>) {
  const entered = deferred<void>(), response = deferred<unknown>();
  f.read.mockImplementationOnce(async () => { entered.resolve(); return response.promise; });
  return { entered, response };
}

describe("manual product settings preserve admitted history", () => {
  it("updates only an unchecked owner-bound incarnation with exact revision", async () => {
    const f = await opened();
    expect(await updateTopicWatch(f.deps, key, spec({ question: "Edited question" }), 999)).toMatchObject({ status: "conflict" });
    expect(await updateTopicWatch(f.deps, key, spec({ question: "Edited question" }), 1)).toMatchObject({ status: "controlled" });
    expect(f.store.snapshot().spec.question).toBe("Edited question");
    await runTopicWatchCheck(f.deps, key);
    const admitted = f.store.snapshot();
    expect(await updateTopicWatch(f.deps, key, spec({ maximumChecksPerPeriod: 128 }), admitted.revision))
      .toMatchObject({ status: "refused", code: "settings-locked" });
    expect(f.store.snapshot()).toEqual(admitted);
  });
  it("requires exact revisions for controls/checks and never edits a cancelled tombstone", async () => {
    const f = await opened();
    expect(await controlTopicWatch(f.deps, key, "paused", 2)).toMatchObject({ status: "conflict" });
    expect(await runTopicWatchCheck(f.deps, key, undefined, 2)).toMatchObject({ status: "conflict" });
    expect(f.read).not.toHaveBeenCalled();
    await controlTopicWatch(f.deps, key, "cancelled", 1);
    expect(await updateTopicWatch(f.deps, key, spec(), 2)).toMatchObject({ status: "refused", code: "cancelled" });
  });
});
let networkTripwire: ReturnType<typeof vi.fn>;
beforeEach(() => {
  networkTripwire = vi.fn(() => { throw new Error("network/paid request reached"); });
  vi.stubGlobal("fetch", networkTripwire);
});
afterEach(() => { expect(networkTripwire).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("manual watch ownership and finite input", () => {
  it("binds saved data to explicit manual consent, without admitting schedule or spend grants", async () => {
    for (const input of [spec({ consent: { manualMetadata: false, emptyHeartbeat: false } } as unknown as Partial<TopicWatchSpec>),
      { ...spec(), ownerWallet: B }, { ...spec(), scheduleConsent: true }, { ...spec(), signedGrant: { amount: 100 } },
      spec({ requestedCaps: { perCheckMicroUsdc: 2, perPeriodMicroUsdc: 1 } }),
      spec({ keywords: ["battery", "BATTERY"] }), spec({ cadenceMs: 1 }), spec({ expiresAtMs: START })]) {
      const f = fixture();
      expect((await createTopicWatch(f.deps, A, input)).status).toBe("refused");
      expect(f.store.writes).toBe(0); expect(f.read).not.toHaveBeenCalled(); expect(f.paid).not.toHaveBeenCalled();
    }
  });

  it("rejects executable or nonportable data without invoking its hooks", async () => {
    const hook = vi.fn(() => "battery");
    const getter = { ...spec() }; Object.defineProperty(getter, "question", { enumerable: true, get: hook });
    const hidden = { ...spec() }; Object.defineProperty(hidden, "secret", { value: "hidden" });
    const symbol = { ...spec(), [Symbol("private")]: true };
    const cycle: Record<string, unknown> = { ...spec() }; cycle.self = cycle;
    const sparse = spec(); sparse.keywords = Array(2); sparse.keywords[1] = "battery";
    for (const input of [getter, hidden, symbol, cycle, sparse, { ...spec(), toJSON: hook },
      { ...spec(), unknown: undefined }, spec({ question: "\ud800" }), spec({ question: "x".repeat(20_000) }),
      spec({ keywords: Array.from({ length: 9 }, (_, i) => `word${i}`) })]) {
      const f = fixture();
      expect((await createTopicWatch(f.deps, A, input)).status).toBe("refused");
      expect(f.store.writes).toBe(0);
    }
    expect(hook).not.toHaveBeenCalled();
  });

  it("copies saved data and atomically refuses a duplicate creation", async () => {
    const input = spec(), f = await opened(input);
    input.question = "changed private input"; input.keywords.push("solar");
    expect((await createTopicWatch(f.deps, A, spec())).status).toBe("conflict");
    await runTopicWatchCheck(f.deps, key);
    expect(f.read.mock.calls[0][0]).toMatchObject({ question: spec().question, keywords: ["battery"], maximumRows: 32 });
    expect(Object.isFrozen(f.read.mock.calls[0][0].keywords)).toBe(true);
    expect(f.store.snapshot().spec.question).toBe(spec().question);
    expect(f.paid).not.toHaveBeenCalled();
  });

  it("accepts omitted optional author/venue filters as empty saved lists", async () => {
    const { authors: omittedAuthors, venues: omittedVenues, ...input } = spec();
    void omittedAuthors; void omittedVenues;
    const f = fixture();
    expect((await createTopicWatch(f.deps, A, input)).status).toBe("created");
    expect(f.store.snapshot().spec).toMatchObject({ authors: [], venues: [] });
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("completed");
  });

  it("refuses unverified/near-match owners before any storage read and isolates identical watch ids", async () => {
    const f = await opened();
    f.owner(null);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "refused", code: "owner-unavailable" });
    expect(f.store.reads).toBe(0);
    f.owner(B);
    const b = fixture(B); b.deps.store = f.store; b.deps.metadata = f.deps.metadata;
    expect((await createTopicWatch(b.deps, B, spec({ question: "B private question" }))).status).toBe("created");
    const bKey = { ...key, ownerWallet: B };
    expect((await controlTopicWatch(f.deps, key, "cancelled")).status).toBe("refused");
    await runTopicWatchCheck(b.deps, bKey);
    expect(f.read.mock.calls[0][0].question).toBe("B private question");
    expect(f.store.snapshot(key).nextSlot).toBe(0);
    expect((await runTopicWatchCheck(b.deps, { ...bKey, ownerWallet: B.toUpperCase() })).status).toBe("refused");
    f.owner(A); f.store.foreignRead = f.store.snapshot(bKey);
    const leaked = await runTopicWatchCheck(f.deps, key);
    expect(leaked).toMatchObject({ status: "refused", code: "state-unavailable" });
    expect(JSON.stringify(leaked)).not.toContain("B private question");
  });
});

describe("lexical metadata digests and deterministic watermark", () => {
  it("reports observed title/name matches without factual judgment or missing-metadata inference", async () => {
    const f = await opened(spec({ authors: ["ada example"], venues: ["example journal"] }));
    f.read.mockResolvedValue({ ...batch(paper(), paper({ title: "Solar observations" })), rows: [
      { state: "unknown", reason: "incomplete-metadata" }, { state: "observed", record: paper() },
      { state: "observed", record: paper({ title: "Solar observations", doi: "10.5555/solar",
        url: "https://doi.org/10.5555/solar", metadataUrl: "https://api.crossref.org/works/10.5555/solar" }) }] });
    const output = await runTopicWatchCheck(f.deps, key);
    expect(output).toMatchObject({ status: "completed", counts: { observedRows: 2, unknownRows: 1, newMatches: 1 }, paidRequests: 0 });
    expect(output.digest?.items[0].matchReasons).toEqual([{ field: "title", term: "battery" },
      { field: "author", term: "ada example" }, { field: "venue", term: "example journal" }]);
    expect(output.digest?.line).toContain("factual support and peer review unverified");
    expect(f.paid).not.toHaveBeenCalled();
  });

  it("deduplicates reordered rows and timestamp-only observations, retains reversions, and reports actual metadata changes", async () => {
    const f = await opened(), records = [numberedPaper(1), numberedPaper(2)];
    f.read.mockResolvedValue(batch(records[0], records[1], records[0]));
    const first = await runTopicWatchCheck(f.deps, key);
    expect(first.counts?.newMatches).toBe(2);
    f.time(START + MINUTE);
    f.read.mockResolvedValue(batch(...records.reverse().map(record => ({ ...record, metadataObservedAt: new Date(START + MINUTE).toISOString() }))));
    const unchanged = await runTopicWatchCheck(f.deps, key);
    expect(unchanged).toMatchObject({ status: "unchanged", watermarkSha256: first.watermarkSha256 });
    expect(unchanged.digest).toBeUndefined();
    f.time(START + 2 * MINUTE); f.read.mockResolvedValue(batch({ ...records[0], title: "Battery corrected title" }));
    expect((await runTopicWatchCheck(f.deps, key)).counts?.newMatches).toBe(1);
    f.time(START + 3 * MINUTE); f.read.mockResolvedValue(batch(records[0]));
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("unchanged");
    expect(f.store.snapshot().watermark).toHaveLength(3);
    const independent = await opened(); independent.read.mockResolvedValue(batch(...records));
    expect((await runTopicWatchCheck(independent.deps, key)).watermarkSha256).toBe(first.watermarkSha256);
  });

  it("retains distinct exact arXiv versions and refuses conflicting same-identity observations", async () => {
    const f = await opened();
    const arxiv = (version: number): PaperRecord => ({ title: "Battery preprint", authors: [], authorCount: 0,
      authorsTruncated: false, arxivId: `2601.12345v${version}`, repository: "arxiv",
      url: `https://arxiv.org/abs/2601.12345v${version}`, metadataUrl: `https://arxiv.org/abs/2601.12345v${version}`,
      metadataObservedAt: new Date(START).toISOString(), publicationKind: "preprint", peerReview: "unknown" });
    f.read.mockResolvedValue(batch(arxiv(1), arxiv(2)));
    expect((await runTopicWatchCheck(f.deps, key)).counts?.newMatches).toBe(2);
    f.time(START + MINUTE); f.read.mockResolvedValue(batch(paper(), paper({ title: "Battery conflicting title" })));
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "failed", code: "conflicting-metadata" });
    expect(f.store.snapshot().watermark).toHaveLength(2);
  });

  it("emits an empty line only on explicit heartbeat consent, including unknown observations", async () => {
    for (const emptyHeartbeat of [false, true]) {
      const f = await opened(spec({ consent: { manualMetadata: true, emptyHeartbeat } }));
      f.read.mockResolvedValue({ version: 1, scope: "metadata-only", status: "available", complete: true,
        rows: [{ state: "unknown", reason: "not-established" }] });
      const output = await runTopicWatchCheck(f.deps, key);
      expect(output).toMatchObject({ status: "unchanged", counts: { observedRows: 0, unknownRows: 1, newMatches: 0 } });
      expect(!!output.digest).toBe(emptyHeartbeat);
      if (emptyHeartbeat) expect(output.digest?.line).toContain("unknown metadata is not evidence of absence");
      expect(f.paid).not.toHaveBeenCalled();
    }
  });

  it("fails closed on digest or watermark capacity instead of truncating or evicting dedup history", async () => {
    const small = await opened(spec({ maximumDigestItems: 1 }));
    small.read.mockResolvedValue(batch(numberedPaper(1), numberedPaper(2)));
    expect(await runTopicWatchCheck(small.deps, key)).toMatchObject({ status: "failed", code: "digest-full" });
    expect(small.store.snapshot().watermark).toHaveLength(0);
    const f = await opened();
    for (let slot = 0; slot < 16; slot++) {
      f.time(START + slot * MINUTE);
      f.read.mockResolvedValue(batch(...Array.from({ length: 16 }, (_, i) => numberedPaper(slot * 16 + i))));
      expect((await runTopicWatchCheck(f.deps, key)).counts?.newMatches).toBe(16);
    }
    f.time(START + 16 * MINUTE); f.read.mockResolvedValue(batch(numberedPaper(999)));
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "failed", code: "watermark-full" });
    expect(f.store.snapshot().watermark).toHaveLength(256);
  });
});

describe("stable claims, caps and honest failed/missed checks", () => {
  it("prevents duplicate overlap before and after the awaited read", async () => {
    const f = await opened(), gate = gateMetadata(f);
    const first = runTopicWatchCheck(f.deps, key); await gate.entered.promise;
    const overlap = await runTopicWatchCheck(f.deps, key);
    expect(overlap.status).toBe("overlap"); expect(f.read).toHaveBeenCalledTimes(1);
    gate.response.resolve(batch(paper())); const completed = await first;
    expect(completed.checkId).toBe(overlap.checkId);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "already-recorded", checkId: completed.checkId });
    expect(f.store.snapshot().period.attempts).toBe(1); expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.paid).not.toHaveBeenCalled();
  });

  it("uses atomic CAS when two workers observed the same unclaimed snapshot", async () => {
    const f = await opened(), both = deferred<void>(), release = deferred<void>(); let claims = 0;
    f.store.beforeSwap = async next => {
      const last = next.history.at(-1);
      if (last?.kind === "check" && last.status === "pending") {
        if (++claims === 2) both.resolve(); await release.promise;
      }
    };
    const one = runTopicWatchCheck(f.deps, key), two = runTopicWatchCheck(f.deps, key);
    await both.promise; release.resolve();
    const outputs = await Promise.all([one, two]);
    expect(outputs.map(output => output.status).sort()).toEqual(["completed", "conflict"]);
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.store.snapshot().period.attempts).toBe(1);
  });

  it.each(["throw", "unavailable", "malformed", "empty"] as const)("never retries an admitted %s check or reaches a paid fallback", async mode => {
    const f = await opened();
    if (mode === "throw") f.read.mockRejectedValue(new Error("PRIVATE upstream detail"));
    else f.read.mockResolvedValue(mode === "unavailable" ? { ...batch(), status: "unavailable" }
      : mode === "malformed" ? { ...batch(paper()), paid: true, fullBody: "PRIVATE body" } : batch());
    const first = await runTopicWatchCheck(f.deps, key);
    expect(first.status).toBe(mode === "empty" ? "unchanged" : "failed");
    expect(JSON.stringify(first)).not.toContain("PRIVATE"); expect(first.digest).toBeUndefined();
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("already-recorded");
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.store.snapshot().period.attempts).toBe(1);
    expect(f.paid).not.toHaveBeenCalled(); expect(first.paidRequests).toBe(0); expect(first.standingSpend).toBe("withheld");
  });

  it("enforces row bounds and rejects partial/full-body/unknown metadata contracts without executing getters", async () => {
    const getter = vi.fn(() => "PRIVATE"); const row = { state: "observed", record: paper() };
    Object.defineProperty(row.record, "title", { enumerable: true, get: getter });
    for (const input of [batch(paper(), numberedPaper(2)), { ...batch(paper()), complete: false },
      { ...batch(paper()), scope: "full-text" }, { ...batch(paper()), rows: [{ state: "unknown", reason: "peer-reviewed" }] },
      { ...batch(paper()), rows: [row] }, batch(paper({ peerReview: "verified" } as unknown as Partial<PaperRecord>))]) {
      const f = await opened(spec({ maximumRowsPerCheck: 1 })); f.read.mockResolvedValue(input);
      expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "failed", code: "invalid-metadata" });
      expect(f.store.snapshot().watermark).toHaveLength(0); expect(f.paid).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("counts failed attempts against the period and records capped slots without granting money", async () => {
    const f = await opened(spec({ maximumChecksPerPeriod: 1, periodMs: 2 * MINUTE }));
    f.read.mockRejectedValueOnce(new Error("unavailable"));
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("failed");
    f.time(START + MINUTE);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "limited", code: "period-cap", paidRequests: 0 });
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("already-recorded");
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.store.snapshot().period.attempts).toBe(1);
    f.time(START + 2 * MINUTE);
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("completed");
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.paid).not.toHaveBeenCalled();
  });

  it("records missed slots as a bounded range and never performs catch-up reads", async () => {
    const f = await opened(); f.time(START + 5 * MINUTE);
    const output = await runTopicWatchCheck(f.deps, key);
    expect(output.missed).toEqual({ fromSlot: 0, toSlot: 4, count: 5 });
    expect(f.store.snapshot().history[0]).toEqual({ kind: "missed", fromSlot: 0, toSlot: 4, detectedAtMs: START + 5 * MINUTE });
    expect(f.read).toHaveBeenCalledTimes(1);
    f.time(START + MINUTE); expect((await runTopicWatchCheck(f.deps, key)).status).toBe("missed");
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it("reports both the missed range and a failed check, including the original failure on retry", async () => {
    const f = await opened(); f.time(START + 5 * MINUTE); f.read.mockRejectedValue(new Error("unavailable"));
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "failed", code: "metadata-unavailable",
      missed: { fromSlot: 0, toSlot: 4, count: 5 } });
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "already-recorded",
      recordedStatus: "failed", code: "metadata-unavailable" });
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it("retains a pending reservation after an unknown CAS acknowledgement, then terminalizes it without a read", async () => {
    const f = await opened(); f.store.commitThenThrow = true;
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("refused");
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("overlap");
    expect(f.read).not.toHaveBeenCalled(); expect(f.store.snapshot().period.attempts).toBe(1);
    f.time(START + 30_000);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "failed", code: "completion-window-elapsed" });
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("already-recorded");
    expect(f.read).not.toHaveBeenCalled(); expect(f.store.snapshot().period.attempts).toBe(1);
  });

  it("refuses new work at the history bound, retaining every prior check", async () => {
    const f = await opened(spec({ periodMs: 24 * 60 * MINUTE, maximumChecksPerPeriod: 128 }));
    f.read.mockResolvedValue(batch());
    for (let slot = 0; slot < 128; slot++) {
      f.time(START + slot * MINUTE); expect((await runTopicWatchCheck(f.deps, key)).status).toBe("unchanged");
    }
    f.time(START + 128 * MINUTE);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "refused", code: "history-full" });
    expect(f.read).toHaveBeenCalledTimes(128); expect(f.store.snapshot().history).toHaveLength(128);
  });
});

describe("pause/cancel/expiry and owner/state changes across awaits", () => {
  it.each(["paused", "cancelled", "expired"] as const)("checks %s before acquisition", async mode => {
    const f = await opened(spec({ expiresAtMs: START + 2000 }));
    if (mode === "expired") f.time(START + 2000); else await controlTopicWatch(f.deps, key, mode);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "refused", code: mode });
    expect(f.read).not.toHaveBeenCalled();
    if (mode === "cancelled") expect((await controlTopicWatch(f.deps, key, "active")).status).toBe("refused");
  });

  it.each(["paused", "cancelled", "expired", "aborted", "revoked", "other-owner", "same-wallet-session", "replaced"] as const)(
    "suppresses late metadata after %s during the awaited read", async mode => {
      const f = await opened(spec({ expiresAtMs: START + 2000 })), gate = gateMetadata(f), abort = new AbortController();
      const running = runTopicWatchCheck(f.deps, key, abort.signal); await gate.entered.promise;
      if (mode === "paused" || mode === "cancelled") await controlTopicWatch(f.deps, key, mode);
      else if (mode === "expired") f.time(START + 2000);
      else if (mode === "aborted") abort.abort();
      else if (mode === "revoked") f.owner(null);
      else if (mode === "other-owner") f.owner(B);
      else if (mode === "same-wallet-session") f.replaceOwnerSession();
      else {
        // A valid replacement incarnation, injected as an external adapter fault/control.
        const replacement = await opened(spec({ question: "Replacement question" }));
        const changed = replacement.store.snapshot(); changed.revision = f.store.snapshot().revision + 1;
        f.store.rows.set(`${A}/${key.watchId}`, changed);
      }
      gate.response.resolve(batch(paper())); const output = await running;
      expect(["interrupted", "refused"]).toContain(output.status); expect(output.digest).toBeUndefined();
      expect(f.store.snapshot().watermark).toHaveLength(0); expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.paid).not.toHaveBeenCalled();
      if (mode === "paused") {
        await controlTopicWatch(f.deps, key, "active");
        expect((await runTopicWatchCheck(f.deps, key)).status).toBe("already-recorded");
        expect(f.store.snapshot().period.attempts).toBe(1);
      }
    });

  it.each([2, 3, 4])("rechecks controls across awaited state read %i", async blockedRead => {
    const f = await opened(), entered = deferred<void>(), release = deferred<void>();
    f.store.beforeRead = async (_key, ordinal) => {
      if (ordinal === blockedRead) { entered.resolve(); await release.promise; }
    };
    const running = runTopicWatchCheck(f.deps, key); await entered.promise;
    expect((await controlTopicWatch(f.deps, key, "cancelled")).status).toBe("controlled");
    release.resolve(); const output = await running;
    expect(output.digest).toBeUndefined(); expect(["interrupted", "refused"]).toContain(output.status);
    expect(f.read).toHaveBeenCalledTimes(blockedRead === 2 ? 0 : 1);
    // At release read 4, metadata was already committed, but no delivery is claimed.
    expect(f.store.snapshot().watermark).toHaveLength(blockedRead === 4 ? 1 : 0);
  });

  it("refuses a finalization CAS overtaken by cancellation", async () => {
    const f = await opened(), entered = deferred<void>(), release = deferred<void>();
    f.store.beforeSwap = async next => {
      const last = next.history.at(-1);
      if (last?.kind === "check" && last.status === "completed") { entered.resolve(); await release.promise; }
    };
    const running = runTopicWatchCheck(f.deps, key); await entered.promise;
    await controlTopicWatch(f.deps, key, "cancelled"); release.resolve();
    expect(await running).toMatchObject({ status: "conflict" });
    expect(f.store.snapshot().watermark).toHaveLength(0);
  });

  it("checks the trusted deadline inside the atomic claim and performs no expired read", async () => {
    const f = await opened(spec({ expiresAtMs: START + 2000 }));
    f.store.beforeSwap = async () => { f.time(START + 2000); };
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("conflict");
    expect(f.store.snapshot().period.attempts).toBe(0); expect(f.read).not.toHaveBeenCalled();
  });

  it("terminalizes an elapsed in-flight check once and suppresses its late completion", async () => {
    const f = await opened(), gate = gateMetadata(f);
    const original = runTopicWatchCheck(f.deps, key); await gate.entered.promise;
    f.time(START + MINUTE);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "failed", code: "completion-window-elapsed" });
    const recovered = f.store.snapshot(), writes = f.store.writes;
    gate.response.resolve(batch(paper())); const late = await original;
    expect(late.status).toBe("interrupted"); expect(late.digest).toBeUndefined();
    expect(f.store.snapshot()).toEqual(recovered); expect(f.store.writes).toBe(writes);
    expect(recovered.period.attempts).toBe(1); expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.store.snapshot().watermark).toHaveLength(0);
    const next = await runTopicWatchCheck(f.deps, key);
    expect(next.status).toBe("completed"); expect(f.read).toHaveBeenCalledTimes(2);
    const checks = f.store.snapshot().history.flatMap(entry => entry.kind === "check" ? [entry] : []);
    expect(checks.map(check => check.status)).toEqual(["failed", "completed"]);
    expect(new Set(checks.map(check => check.checkId)).size).toBe(2);
  });

  it("manually terminalizes a stalled expired claim without new work, then retains it on late completion", async () => {
    const f = await opened(spec({ expiresAtMs: START + 2000, maximumChecksPerPeriod: 1 })), gate = gateMetadata(f);
    const original = runTopicWatchCheck(f.deps, key); await gate.entered.promise;
    const claimed = f.store.snapshot();
    expect(claimed.history).toHaveLength(1);
    expect(claimed.history[0]).toMatchObject({ kind: "check", status: "pending", slot: 0, deadlineAtMs: START + 2000 });
    f.time(START + 2000);
    const recovery = await runTopicWatchCheck(f.deps, key), recovered = f.store.snapshot();
    expect(recovery).toMatchObject({ status: "interrupted", code: "expired", paidRequests: 0, standingSpend: "withheld" });
    expect(recovery.digest).toBeUndefined(); expect(recovery.counts).toBeUndefined();
    expect(recovered).toEqual({ ...claimed, revision: claimed.revision + 1,
      history: claimed.history.map(entry => entry.kind === "check"
        ? { ...entry, status: "interrupted", reason: "expired", finishedAtMs: START + 2000 } : entry) });
    expect(recovered.history[0]).toMatchObject({ checkId: recovery.checkId });
    expect(recovered.nextSlot).toBe(1); expect(recovered.period).toEqual({ index: 0, attempts: 1 });
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.store.writes).toBe(3);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "refused", code: "expired" });
    expect(await controlTopicWatch(f.deps, key, "active")).toMatchObject({ status: "refused", code: "expired" });
    // Even a later period cannot reset the expired watch's consumed attempt.
    f.time(START + 20 * MINUTE);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "refused", code: "expired" });
    gate.response.resolve(batch(paper())); const late = await original;
    expect(late).toMatchObject({ status: "interrupted", code: "state-changed", checkId: recovery.checkId });
    expect(late.digest).toBeUndefined(); expect(late.counts).toBeUndefined(); expect(late.watermarkSha256).toBeUndefined();
    expect(f.store.snapshot()).toEqual(recovered); expect(f.store.writes).toBe(3);
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.paid).not.toHaveBeenCalled();
  });

  it.each(["revoked", "foreign-owner", "same-wallet-session"] as const)(
    "requires the original current authority after %s, before recovery and after retained recovery", async mode => {
      for (const recoverFirst of [false, true]) {
        const f = await opened(spec({ expiresAtMs: START + 2000 })), gate = gateMetadata(f);
        const original = runTopicWatchCheck(f.deps, key); await gate.entered.promise;
        f.time(START + 2000);
        if (recoverFirst) expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "interrupted", code: "expired" });
        const retained = f.store.snapshot(), reads = f.store.reads, writes = f.store.writes;
        if (mode === "revoked") f.owner(null);
        else if (mode === "foreign-owner") f.owner(B);
        else f.replaceOwnerSession();
        expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "refused", code: "owner-unavailable" });
        gate.response.resolve(batch(paper())); const late = await original;
        expect(late).toMatchObject({ status: "refused", code: "owner-unavailable" });
        expect(late.digest).toBeUndefined(); expect(late.checkId).toBeUndefined();
        expect(f.store.reads).toBe(reads); expect(f.store.writes).toBe(writes);
        expect(f.store.snapshot()).toEqual(retained); expect(retained.period.attempts).toBe(1);
        expect(f.read).toHaveBeenCalledTimes(1); expect(f.paid).not.toHaveBeenCalled();
      }
    });

  it("refuses a verified foreign owner's expired recovery before reads and isolates matching watch namespaces", async () => {
    const f = await opened(spec({ expiresAtMs: START + 2000 })), b = fixture(B), gate = gateMetadata(f);
    b.deps.store = f.store;
    const bKey = { ...key, ownerWallet: B };
    expect((await createTopicWatch(b.deps, B, spec({ question: "B private question", expiresAtMs: START + 2000 }))).status).toBe("created");
    const foreign = f.store.snapshot(bKey);
    const original = runTopicWatchCheck(f.deps, key); await gate.entered.promise;
    f.time(START + 2000); b.time(START + 2000);
    const claimed = f.store.snapshot(), reads = f.store.reads, writes = f.store.writes;
    const denied = await runTopicWatchCheck(b.deps, key);
    expect(denied).toMatchObject({ status: "refused", code: "owner-unavailable" });
    expect(f.store.reads).toBe(reads); expect(f.store.writes).toBe(writes);
    expect(f.store.snapshot()).toEqual(claimed); expect(b.read).not.toHaveBeenCalled();
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "interrupted", code: "expired" });
    const recovered = f.store.snapshot();
    gate.response.resolve(batch(paper())); const late = await original;
    expect(late.status).toBe("interrupted"); expect(late.digest).toBeUndefined();
    expect(JSON.stringify(late)).not.toContain("B private question");
    expect(f.store.snapshot()).toEqual(recovered); expect(f.store.snapshot(bKey)).toEqual(foreign);
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.paid).not.toHaveBeenCalled(); expect(b.paid).not.toHaveBeenCalled();
  });

  it("retains period capacity and a newer capped slot when a recovered worker completes late", async () => {
    const f = await opened(spec({ maximumChecksPerPeriod: 1 })), gate = gateMetadata(f);
    const original = runTopicWatchCheck(f.deps, key); await gate.entered.promise;
    f.time(START + MINUTE);
    const recovered = await runTopicWatchCheck(f.deps, key);
    expect(recovered).toMatchObject({ status: "failed", code: "completion-window-elapsed" });
    const capped = await runTopicWatchCheck(f.deps, key);
    expect(capped).toMatchObject({ status: "limited", code: "period-cap", paidRequests: 0, standingSpend: "withheld" });
    const newer = f.store.snapshot(), writes = f.store.writes;
    expect(newer.period).toEqual({ index: 0, attempts: 1 }); expect(newer.nextSlot).toBe(2);
    expect(newer.history.map(entry => entry.kind === "check" ? entry.status : entry.kind)).toEqual(["failed", "limited"]);
    gate.response.resolve(batch(paper())); const late = await original;
    expect(late).toMatchObject({ status: "interrupted", code: "state-changed", checkId: recovered.checkId });
    expect(late.digest).toBeUndefined(); expect(late.watermarkSha256).toBeUndefined();
    expect(f.store.snapshot()).toEqual(newer); expect(f.store.writes).toBe(writes);
    expect(await runTopicWatchCheck(f.deps, key)).toMatchObject({ status: "already-recorded", checkId: capped.checkId, recordedStatus: "limited" });
    expect(f.store.snapshot()).toEqual(newer); expect(f.read).toHaveBeenCalledTimes(1); expect(f.paid).not.toHaveBeenCalled();
  });

  it("treats absent or failed storage as unavailable without a fallback", async () => {
    const f = await opened();
    f.deps.store = undefined as unknown as TopicWatchStore;
    expect((await runTopicWatchCheck(f.deps, key)).status).toBe("refused"); expect(f.read).not.toHaveBeenCalled();
    f.deps.store = f.store; f.store.read = async () => { throw new Error("PRIVATE storage detail"); };
    const output = await runTopicWatchCheck(f.deps, key);
    expect(output.status).toBe("refused"); expect(JSON.stringify(output)).not.toContain("PRIVATE");
    expect(f.read).not.toHaveBeenCalled(); expect(f.paid).not.toHaveBeenCalled();
  });
});

it("keeps the authored watch runtime graph free of paid/provider/body capabilities", () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const imports = (value: string) => [...value.matchAll(/^import .* from "([^"]+)";/gm)].map(match => match[1]);
  const domain = source("./topic-watches.ts"), schema = source("../papers/types.ts");
  expect(imports(domain)).toEqual(["node:crypto", "zod", "../papers/types"]);
  expect(imports(schema)).toEqual(["zod", "../scholarly/doi", "../scholarly/arxiv-identity"]);
  for (const value of [domain, schema, source("../scholarly/doi.ts"), source("../scholarly/arxiv-identity.ts")]) {
    expect(value).not.toMatch(/\b(?:fetch|payFetch|payCitation|require|import)\s*\(/);
    expect(value).not.toMatch(/from ["'][^"']*(?:provider|payments|gateway|config|\/db|discovery|search)["']/);
  }
});

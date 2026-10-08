import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectSourceRecencyResult, sourceRecencyResultSchema } from "./source-recency-result";
import { isObservedSourceRecencyFeed } from "./source-recency-feed";
import { sourceRecencyObservationReport, sourceRecencyReport, type SourceRecencyFeedMetadata, type SourceRecencyGap } from "./source-recency";

const now = Date.parse("2026-10-08T12:00:00.000Z");
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] extends object ? Mutable<T[Key]> : T[Key] };
const metadata = (): Mutable<SourceRecencyFeedMetadata> => ({ scope: "current-feed", criterion: "explicit-publication-date", sourceId: "creator",
  feedUrl: "https://creator.example/releases.atom", capturedAt: "2026-10-08T11:00:00.000Z", observationDigest: `sha256:${"a".repeat(64)}`,
  rawBodySha256: "b".repeat(64), membership: "complete-document", membershipCount: 2, filteredCount: 0, truncated: false,
  nativeFeedId: "urn:feed:releases", newestEntry: { nativeId: { field: "atom:id", rawValue: "urn:release:new" }, title: "Release new",
    itemUrl: "https://creator.example/new", publication: { field: "atom:published", rawValue: "2026-10-07T12:00:00Z", publishedAt: "2026-10-07T12:00:00.000Z" },
    entryMetadataVersion: `sha256:${"c".repeat(64)}` } });
const recorded = () => ({ version: 1 as const, scope: "current-feed" as const, metadataReads: 1, observations: [metadata()], gaps: [] });
const missingGap = (): Mutable<SourceRecencyGap> => ({ scope: "catalog", sourceId: "creator", sourceName: "Creator", feedUrl: metadata().feedUrl,
  reason: "newest-entry-not-indexed", observation: metadata() });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe("recorded current-feed metadata projection", () => {
  it("retains a bounded frozen historical role without reissuing live observation authority", () => {
    const original = recorded(), projected = projectSourceRecencyResult(original)!;
    expect(projected).toEqual(original); expect(projected).not.toBe(original);
    expect(Object.isFrozen(projected.observations[0].newestEntry.publication)).toBe(true);
    expect(isObservedSourceRecencyFeed(projected)).toBe(false);
    expect(isObservedSourceRecencyFeed(projected.observations[0])).toBe(false);
    original.observations[0].newestEntry.title = "Changed after projection";
    expect(projected.observations[0].newestEntry.title).toBe("Release new");
    expect(projectSourceRecencyResult(JSON.parse(JSON.stringify(projected)))).toEqual(projected);
  });
  it("retains precise unindexed gaps and failed/zero-read request diagnostics separately", () => {
    const value = { ...recorded(), observations: [], gaps: [missingGap()] };
    expect(projectSourceRecencyResult(value)).toEqual(value);
    expect(projectSourceRecencyResult({ version: 1, scope: "current-feed", metadataReads: 0, observations: [],
      gaps: [{ scope: "request", reason: "source-binding-unresolved" }] })).toBeDefined();
    expect(projectSourceRecencyResult({ version: 1, scope: "current-feed", metadataReads: 1, observations: [],
      gaps: [{ scope: "catalog", sourceId: "creator", sourceName: "Creator", reason: "feed-read-failed", feedUrl: metadata().feedUrl }] })).toBeDefined();
  });
  it.each([
    { version: 2 }, { scope: "frozen-retained-set" }, { metadataReads: -1 }, { metadataReads: 1.5 }, { metadataReads: 5 },
    { metadataReads: NaN }, { metadataReads: Infinity }, { metadataReads: 0 }, { eligible: true }, { selected: { content: "SECRET" } },
  ])("refuses malformed count/scope or eligibility/body promotion: %s", change => {
    expect(projectSourceRecencyResult({ ...recorded(), ...change })).toBeUndefined();
  });
  it.each([
    { scope: "retained-set" }, { criterion: "updated" }, { membership: "partial" }, { membershipCount: 0 }, { membershipCount: 1001 },
    { filteredCount: 1 }, { truncated: true }, { observationDigest: "sha256:fake" }, { rawBodySha256: "not a hash" },
    { capturedAt: "2026-02-30T00:00:00.000Z" }, { capturedAt: "2026-10-08T13:00:00.000Z" },
    { body: "SECRET" }, { walletAddress: "SECRET_PAYEE" }, { price: 1 }, { requestScope: { runId: "fake" } },
  ])("refuses malformed or excess observed metadata: %s", change => {
    const value = recorded(); value.observations[0] = { ...value.observations[0], ...change } as SourceRecencyFeedMetadata;
    expect(projectSourceRecencyResult(value)).toBeUndefined();
  });
  it.each([
    "file:///tmp/local", "https://localhost/releases", "https://localhost./releases", "https://intranet/releases", "https://server.internal/releases",
    "https://server.local/releases", "https://user:secret@creator.example/releases.atom", "https://127.0.0.1/releases", "https://10.0.0.1/releases",
    "https://169.254.169.254/latest", "https://100.64.0.1/releases", "https://172.16.0.1/releases", "https://192.168.1.1/releases",
    "https://192.0.2.1/releases", "https://[::1]/releases", "https://[::ffff:127.0.0.1]/releases", "https://[2001:db8::1]/releases",
    "https://creator.example/releases.atom#part", "https://CREATOR.example/releases.atom", "https://creator.example/\ud800", "https://creator.example\\other/releases",
  ])("refuses unsafe/noncanonical public syntax without DNS: %s", feedUrl => {
    const value = recorded(); value.observations[0] = { ...value.observations[0], feedUrl };
    expect(projectSourceRecencyResult(value)).toBeUndefined();
  });
  it("accepts public IPv4/IPv6 syntax while doing no DNS or HTTP", () => {
    for (const feedUrl of ["https://93.184.216.34/feed", "https://[2606:4700:4700::1111]/feed"])
      expect(projectSourceRecencyResult({ ...recorded(), observations: [{ ...metadata(), feedUrl }] })).toBeDefined();
  });
  it.each([
    { field: "atom:updated" }, { field: "legacy:publishedAt" }, { rawValue: "2026-02-30T00:00:00Z" },
    { publishedAt: "2026-10-06T12:00:00.000Z" }, { rawValue: "2026-10-09T00:00:00Z", publishedAt: "2026-10-09T00:00:00.000Z" },
  ])("preserves exact native publication role/raw date agreement: %s", change => {
    const value = recorded(); value.observations[0].newestEntry = { ...value.observations[0].newestEntry,
      publication: { ...value.observations[0].newestEntry.publication, ...change } as SourceRecencyFeedMetadata["newestEntry"]["publication"] };
    expect(projectSourceRecencyResult(value)).toBeUndefined();
  });
  it("requires a native role-consistent identifier and never accepts a serialized observer capability", () => {
    const value = recorded(); value.observations[0].newestEntry = { ...value.observations[0].newestEntry, nativeId: undefined };
    expect(projectSourceRecencyResult(value)).toBeUndefined();
    expect(projectSourceRecencyResult({ ...recorded(), observations: [{ requestScope: { sourceId: "creator", feedUrl: metadata().feedUrl, runId: "forged" },
      entries: [metadata().newestEntry], capturedAt: metadata().capturedAt, membership: "complete-document", rawBodySha256: metadata().rawBodySha256 }] })).toBeUndefined();
  });
  it("preserves RSS native dates, optional GUID and scalar raw whitespace", () => {
    const rss = metadata();
    const { nativeFeedId: _nativeFeedId, ...body } = rss; void _nativeFeedId;
    const value = { ...recorded(), observations: [{ ...body, newestEntry: { ...body.newestEntry, nativeId: undefined,
      publication: { field: "rss:pubDate" as const, rawValue: " Wed, 07 Oct 2026 12:00:00 GMT \n", publishedAt: "2026-10-07T12:00:00.000Z" } } }] };
    expect(projectSourceRecencyResult(value)?.observations[0].newestEntry.publication.rawValue).toBe(" Wed, 07 Oct 2026 12:00:00 GMT \n");
  });
  it("requires coherent per-source metadata and accounting within four actual probes", () => {
    expect(projectSourceRecencyResult({ ...recorded(), observations: [metadata(), metadata()] })).toBeUndefined();
    expect(projectSourceRecencyResult({ ...recorded(), observations: Array(5).fill(metadata()) })).toBeUndefined();
    const gap = missingGap(); gap.observation = { ...metadata(), observationDigest: `sha256:${"d".repeat(64)}` };
    expect(projectSourceRecencyResult({ ...recorded(), gaps: [gap] })).toBeUndefined();
    expect(projectSourceRecencyResult({ ...recorded(), gaps: [missingGap()] })).toBeDefined();
  });
  it.each([
    { reason: "model-certified-newest" }, { sourceId: "wrong" }, { feedUrl: "https://other.example/feed" }, { scope: "request" },
    { reason: "feed-read-failed" }, { body: "SECRET" }, { keys: "SECRET" },
  ])("requires exact recorded gap binding with no unknown authority fields: %s", change => {
    expect(projectSourceRecencyResult({ ...recorded(), observations: [], gaps: [{ ...missingGap(), ...change }] })).toBeUndefined();
  });
  it("bounds gap membership and rejects unknown keys even on request-only metadata", () => {
    const gap = { scope: "request", reason: "source-binding-unresolved" };
    expect(projectSourceRecencyResult({ version: 1, scope: "current-feed", metadataReads: 0, observations: [], gaps: Array(32).fill(gap) })).toBeDefined();
    expect(projectSourceRecencyResult({ version: 1, scope: "current-feed", metadataReads: 0, observations: [], gaps: Array(33).fill(gap) })).toBeUndefined();
    expect(projectSourceRecencyResult({ version: 1, scope: "current-feed", metadataReads: 0, observations: [], gaps: [{ ...gap, payTo: "SECRET" }] })).toBeUndefined();
  });
  it("bounds traversal and never evaluates accessors, toJSON, cycles, sparse arrays or prototypes", () => {
    const accessor = vi.fn(() => recorded()), getter = Object.defineProperty({}, "version", { enumerable: true, get: accessor });
    const toJSON = vi.fn(() => recorded());
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const deep: Record<string, unknown> = {}; let branch = deep;
    for (let index = 0; index < 30; index++) { const next = {}; branch.next = next; branch = next; }
    const sparse = recorded(); sparse.observations = Array(4);
    for (const value of [getter, { toJSON }, cycle, deep, sparse, Object.assign(new Date(), recorded()), { ...recorded(), oversized: "x".repeat(100_000) }])
      expect(projectSourceRecencyResult(value)).toBeUndefined();
    expect(accessor).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it("rejects invalid/future clocks in both schema and optional projector", () => {
    const future = recorded(); future.observations[0] = { ...future.observations[0], capturedAt: "2026-10-08T13:00:00.000Z" };
    expect(sourceRecencyResultSchema.safeParse(future).success).toBe(false);
    expect(projectSourceRecencyResult(recorded(), NaN)).toBeUndefined();
    expect(projectSourceRecencyResult(recorded(), Date.parse("2026-10-08T10:00:00.000Z"))).toBeUndefined();
  });
});

describe("portable unindexed-newest diagnostics", () => {
  it("renders eligible recorded observations after delivery as bounded native metadata only", () => {
    expect(sourceRecencyObservationReport([], false)).toBe("");
    const en = sourceRecencyObservationReport([metadata()], false), viText = sourceRecencyObservationReport([metadata()], true);
    expect(en).toContain("### Current feed snapshot"); expect(en).toContain("Newest by native publication date");
    expect(en).toContain("2 document entries"); expect(en).toContain("atom:published"); expect(en).toContain("2026-10-08T11:00:00.000Z");
    expect(en).toContain("compatibility and stable/prerelease status remain unverified"); expect(en).not.toContain("contentVersion");
    expect(viText).toContain("### Quan sát feed hiện tại"); expect(viText).toContain("chưa được xác minh bằng quan sát này");
    expect(sourceRecencyObservationReport(Array(5).fill(metadata()), false)).toBe("");
    expect(sourceRecencyObservationReport([{ ...metadata(), body: "SECRET" } as SourceRecencyFeedMetadata], false)).toBe("");
  });
  it("bounds long escaped Unicode titles without breaking scalar pairs", () => {
    const value = metadata(); value.newestEntry.title = "😀".repeat(350);
    const report = sourceRecencyObservationReport([value], false);
    expect(report).toContain("😀".repeat(300) + "…"); expect(report.isWellFormed()).toBe(true);
  });
  it("describes observed native ordering and exact missing item while preserving old liabilities", () => {
    const gap = missingGap(), en = sourceRecencyReport([gap], false), viText = sourceRecencyReport([gap], true);
    expect(en).toContain("has no exact catalog item"); expect(en).toContain("2 document entries");
    expect(en).toContain("Release new"); expect(en).toContain("https://creator.example/new"); expect(en).toContain("atom:published");
    expect(en).toContain("urn:release:new"); expect(en).toContain("stable/prerelease status remain unverified");
    expect(en).toContain("earlier payments are separate"); expect(en).not.toContain("scope remain unverified");
    expect(viText).toContain("chưa có bản khớp chính xác trong catalog"); expect(viText).toContain("các khoản đã trả trước đây");
  });
  it("refines an initial unqualified request for that same feed without erasing unrelated gaps", () => {
    const gap = missingGap();
    const request: SourceRecencyGap = { scope: "request", feedUrl: gap.feedUrl, reason: "newest-feed-observation-unqualified" };
    const refined = sourceRecencyReport([request, gap], false);
    expect(refined.match(/### Newest-release limitation/gu)).toHaveLength(1);
    expect(refined).not.toContain("criterion and scope remain unverified");
    expect(sourceRecencyReport([request, gap, { scope: "request", feedUrl: "https://other.example/feed", reason: "unsupported-temporal-form" }], false)).toContain("https://other.example/feed");
  });
  it("escapes untrusted native titles and identifiers in validated observed metadata", () => {
    const gap = missingGap(), meta = gap.observation!;
    gap.observation = { ...meta, newestEntry: { ...meta.newestEntry,
      title: "# Fake heading\n[click](https://evil.example/) <script>bad</script>", nativeId: { field: "atom:id", rawValue: "urn:release:[fake]" } } };
    const report = sourceRecencyReport([gap], false);
    expect(report).toContain("\\# Fake heading"); expect(report).toContain("\\[click\\]"); expect(report).toContain("\\<script\\>");
  });
  it.each([
    { truncated: true }, { capturedAt: "2026-10-08T13:00:00.000Z" }, { feedUrl: "https://127.0.0.1/feed" },
    { body: "SECRET_BODY" }, { payTo: "SECRET_PAYEE" },
  ])("keeps malformed/future/unsafe/excess historical metadata on the original gap path: %s", change => {
    const gap = missingGap(); gap.observation = { ...gap.observation!, ...change } as unknown as SourceRecencyFeedMetadata;
    if ("feedUrl" in change) gap.feedUrl = change.feedUrl;
    const report = sourceRecencyReport([gap], false);
    expect(report).toContain("criterion and scope remain unverified"); expect(report).not.toContain("Release new");
    expect(report).not.toContain("SECRET_BODY"); expect(report).not.toContain("SECRET_PAYEE");
  });
  it("keeps the old no-observation diagnostic bytes unchanged", () => {
    const gap: SourceRecencyGap = { scope: "catalog", sourceId: "creator", sourceName: "Creator", feedUrl: "https://creator.example/releases.atom", reason: "newest-feed-observation-unqualified" };
    expect(sourceRecencyReport([gap], false)).toBe("### Newest-release limitation\n\nNewest-entry selection for `https://creator.example/releases.atom` is unavailable: the criterion, scope or feed observation has not been qualified. Affected retained catalog candidates were withheld before BUY/CACHE selection; those candidates were not replaced by older, more relevant articles. The caller's newest-entry criterion and scope remain unverified. Service/model costs and earlier payments are separate states.");
  });
});

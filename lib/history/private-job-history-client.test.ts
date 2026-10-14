import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrivateJobHistoryClient, guardPrivateJobHistoryPage, guardPrivateJobHistoryDetail,
  guardPrivateJobHistoryExport, privateJobHistoryMetadataCsv, PRIVATE_JOB_HISTORY_REFUSAL } from "./private-job-history-client";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, PRIVATE_JOB_HISTORY_QUALIFICATION, privateJobHistoryCapabilities,
  type PrivateJobHistoryRow, type PrivateJobHistoryExport } from "./private-job-history-contract";
import { privateJobHistoryCsv } from "./private-job-history";

// Auth/HTTPS are synthetic. No server/store/payment/delivery acceptance is implied.
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const token = `kx_live_${"1".repeat(96)}`, otherToken = `kx_live_${"2".repeat(96)}`;
const id = (n = "1") => `prv_${n.repeat(64)}`;
const date = "2026-10-14T00:00:00.123456+00:00";
const envelope = (wallet = alice) => ({ format: "private-job-history-v1", wallet,
  scope: "exact-payer-private-current-store", capabilities: privateJobHistoryCapabilities, qualification: PRIVATE_JOB_HISTORY_QUALIFICATION } as const);
const row = (ownerWallet = alice): PrivateJobHistoryRow => ({ id: id(), ownerWallet, createdAt: date, intentCreatedAt: date,
  savedAt: date, question: "PRIVATE question", researchMode: "deep", model: null, packageVersion: "1.0.0",
  record: "finalized-private-result", provenance: null, incomingSettlement: { status: "settled", amountMicros: "120000",
    network: "eip155:5042", reference: "incoming", settledAt: date, evidenceSource: "circle-facilitator-success", chainFinalityVerified: false },
  ownSettledSpendMicros: null, creatorRewardsMicros: null, paidCreators: null });
const page = (wallet = alice) => ({ ...envelope(wallet), rows: [row(wallet)], nextCursor: null, scanLimited: false, scannedIntents: 1 });
const detail = () => ({ ...envelope(), row: { ...row(), intentCreatedAt: null }, result: { answer: "PRIVATE answer",
  engine: "saved", createdAt: date, savedAt: date, subClaims: [], decisions: [], citations: [], evidence: null,
  claimCoverage: null, paymentEvidence: "incoming-only-no-creator-ledger" } });
const exported = (): PrivateJobHistoryExport => ({ ...envelope(), format: "private-job-history-v1", scope: "exact-payer-private-current-store",
  rows: [row()], nextCursor: null, complete: true, truncated: false, pages: 1,
  bounds: { maxPages: 20, maxRows: 500, maxBytes: 2097152 } });
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve }; }
afterEach(() => vi.useRealTimers());

describe("completed private-history HTTPS client (source fixtures)", () => {
  it("calls all three exact POST contracts without URL selectors, cookies, redirects or payments", async () => {
    const fetcher = vi.fn<typeof fetch>(async url => Response.json(String(url).endsWith("/detail") ? detail()
      : String(url).endsWith("/export") ? exported() : page()));
    const client = createPrivateJobHistoryClient("https://example.test", () => token, fetcher);
    const filters = { search: "PRIVATE", surface: "unknown" as const, network: "eip155:5042" as const, from: date, to: date, limit: 1 };
    expect(await client.list(filters)).toMatchObject({ wallet: alice });
    expect(await client.detail({ id: id() })).toMatchObject({ result: { answer: "PRIVATE answer" } });
    expect(await client.export(filters)).toMatchObject({ complete: true, truncated: false, rows: [{ ownSettledSpendMicros: null }] });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(["https://example.test/api/me/private-jobs",
      "https://example.test/api/me/private-jobs/detail", "https://example.test/api/me/private-jobs/export"]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
      expect(init!.headers).toMatchObject({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" });
      expect(Object.keys(JSON.parse(String(init!.body)))).not.toContain("wallet");
    }
    expect(fetcher.mock.calls[0][1]!.headers).not.toHaveProperty("x-keryx-expected-wallet");
    expect(fetcher.mock.calls[1][1]!.headers).toHaveProperty("x-keryx-expected-wallet", alice);
    expect(JSON.parse(String(fetcher.mock.calls[2][1]!.body))).toEqual({ ...filters, format: "json" });
  });
  it.each(["http://example.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?token=x", "https://example.test/#x", "bad"])("refuses unsafe origin %s", origin => {
    expect(() => createPrivateJobHistoryClient(origin, () => token)).toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
  });
  it.each([undefined, "", "kx_live_BAD", `${token}\n`])("requires an exact explicit key before IO", async key => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createPrivateJobHistoryClient("https://example.test", () => key, fetcher).list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ owner: alice }, { wallet: alice }, { limit: 0 }, { limit: 26 }, { limit: Infinity }, { search: "\ud800" },
    { cursor: "secret/query" }, { from: "2026-10-15T00:00:00Z", to: "2026-10-14T00:00:00Z" }])("refuses strict invalid input with zero IO", async input => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list(input as never)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("expected wallet is only a precondition and foreign responses refuse", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(page(bob)));
    await expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list({}, { expectedWallet: alice })).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(fetcher.mock.calls[0][1]!.headers).toHaveProperty("x-keryx-expected-wallet", alice);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]!.body))).toEqual({ limit: 25 });
  });
  it("binds the server-returned owner across calls rather than caller config", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page())).mockResolvedValueOnce(Response.json(page(bob)));
    const client = createPrivateJobHistoryClient("https://example.test", () => token, fetcher);
    await client.list(); await expect(client.list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
  });
  it("refuses replacement key during transport, cancels late body, never retries", async () => {
    let key = token; const transport = deferred<Response>(), started = deferred<void>(), cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => { started.resolve(); return transport.promise; });
    const request = createPrivateJobHistoryClient("https://example.test", () => key, fetcher).list();
    const result = expect(request).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await started.promise; key = otherToken;
    transport.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
    await result; expect(cancel).toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses loss of key while decoded body is pending", async () => {
    let key: string | undefined = token; let stream!: ReadableStreamDefaultController<Uint8Array>;
    const started = deferred<void>(), fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) { stream = controller; started.resolve(); },
    }), { headers: { "content-type": "application/json; charset=utf-8" } }));
    const request = createPrivateJobHistoryClient("https://example.test", () => key, fetcher).list();
    const result = expect(request).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await started.promise; key = undefined; stream.enqueue(new TextEncoder().encode(JSON.stringify(page()))); stream.close();
    await result; expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fences same-client replacement key between operations and immediately before output", async () => {
    let key = token; const fetcher = vi.fn<typeof fetch>(async () => Response.json(page()));
    const client = createPrivateJobHistoryClient("https://example.test", () => key, fetcher);
    await client.list(); key = otherToken;
    expect(() => client.current()).toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await expect(client.list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 409, 503, 302])("keeps HTTP %s private refusal generic and single attempt", async status => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(`PRIVATE ${token}`, { status }));
    await expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["text/plain", "text/csv", "application/json; charset=latin1", "application/json; x=secret"])("refuses incompatible MIME %s", async mime => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(page()), { headers: { "content-type": mime } }));
    await expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
  });
  it.each(["-1", "NaN", String(B.pageBytes + 1)])("refuses invalid declared bound %s", async length => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(page()), {
      headers: { "content-type": "application/json", "content-length": length } }));
    await expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
  });
  it("bounds actual decoded bytes even with a false small Content-Length", async () => {
    const cancel = vi.fn(), fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(B.pageBytes + 1)); }, cancel,
    }), { headers: { "content-type": "application/json", "content-length": "1" } }));
    await expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(cancel).toHaveBeenCalled();
  });
  it.each([new Uint8Array([0xc3, 0x28]), new TextEncoder().encode("{private invalid json}")])("refuses malformed UTF8/JSON without echo", async bytes => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes, { headers: { "content-type": "application/json" } }));
    await expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
  });
  it("races an ignored transport against finite timeout and pre-abort has zero IO", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const client = createPrivateJobHistoryClient("https://example.test", () => token, fetcher);
    const result = expect(client.list()).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await vi.advanceTimersByTimeAsync(B.readMs); await result; expect(fetcher).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    await expect(client.list({}, { signal: controller.signal })).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("suppresses abort during a pending body even if stream ignores it", async () => {
    const started = deferred<void>(), cancel = vi.fn(), controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start() { started.resolve(); }, cancel }),
      { headers: { "content-type": "application/json" } }));
    const result = expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher).list({}, { signal: controller.signal })).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await started.promise; controller.abort(); await result; expect(cancel).toHaveBeenCalled();
  });
  it.each(["list", "detail", "export"] as const)("pre-aborted %s does not read/bind the key or start HTTPS", async operation => {
    const key = vi.fn(() => token), fetcher = vi.fn<typeof fetch>(), controller = new AbortController(); controller.abort();
    const client = createPrivateJobHistoryClient("https://example.test", key, fetcher);
    const request = operation === "detail" ? client.detail({ id: id() }, { signal: controller.signal })
      : client[operation]({}, { signal: controller.signal });
    await expect(request).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(key).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels an ignored export transport immediately and cancels its late private body without a follow-up request", async () => {
    const started = deferred<void>(), stopped = deferred<void>(), late = deferred<Response>(), bodyStopped = deferred<void>();
    const controller = new AbortController(); let signal!: AbortSignal;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init!.signal as AbortSignal; signal.addEventListener("abort", () => stopped.resolve(), { once: true });
      started.resolve(); return late.promise;
    });
    const result = expect(createPrivateJobHistoryClient("https://example.test", () => token, fetcher)
      .export({}, { signal: controller.signal })).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await started.promise; controller.abort(); await stopped.promise; await result;
    late.resolve(new Response(new ReadableStream({ cancel() { bodyStopped.resolve(); } }), { headers: { "content-type": "application/json" } }));
    await bodyStopped.promise; expect(signal.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("same-contract private outputs", () => {
  it("preserves UNKNOWN provenance and NULL money; no price-to-spend conversion", () => {
    expect(guardPrivateJobHistoryPage(page()).rows[0]).toMatchObject({ provenance: null, ownSettledSpendMicros: null,
      creatorRewardsMicros: null, paidCreators: null, incomingSettlement: { amountMicros: "120000", chainFinalityVerified: false } });
  });
  it("checks rows, owner, applied filters, intent timestamps and continuation", () => {
    for (const raw of [{ ...page(), extra: "private" }, { ...page(), rows: [{ ...row(), ownerWallet: bob }] },
      { ...page(), rows: [{ ...row(), intentCreatedAt: null }] }, { ...page(), rows: [row(), row()], scannedIntents: 2 },
      { ...page(), nextCursor: "bad/url" }, { ...page(), nextCursor: "next", scanLimited: false },
      { ...page(), rows: [{ ...row(), ownSettledSpendMicros: "120000" }] }, { ...page(), rows: [{ ...row(), question: "\ud800" }] }]) {
      expect(() => guardPrivateJobHistoryPage(raw)).toThrow();
    }
    for (const filters of [{ search: "absent" }, { surface: "web" as const }, { network: "eip155:5042002" as const },
      { from: "2026-10-14T00:00:00.123457+00:00" }, { to: "2026-10-14T00:00:00.123455+00:00" }]) {
      expect(() => guardPrivateJobHistoryPage(page(), filters)).toThrow();
    }
    expect(guardPrivateJobHistoryPage({ ...page(), rows: [], nextCursor: "next", scanLimited: true, scannedIntents: 25 }).nextCursor).toBe("next");
    expect(() => guardPrivateJobHistoryPage({ ...page(), nextCursor: "same", scanLimited: true }, { cursor: "same" })).toThrow();
  });
  it("requires decreasing intent positions rather than finalized-run dates", () => {
    const newer = { ...row(), id: id("2"), createdAt: "2020-01-01T00:00:00Z", intentCreatedAt: "2026-10-14T00:00:00.123457+00:00" };
    expect(guardPrivateJobHistoryPage({ ...page(), rows: [newer, row()], scannedIntents: 2 }).rows).toHaveLength(2);
    expect(() => guardPrivateJobHistoryPage({ ...page(), rows: [row(), newer], scannedIntents: 2 })).toThrow();
  });
  it("bounds detail and checks selected ID/owner/claim mapping without a public link", () => {
    expect(guardPrivateJobHistoryDetail(detail(), id(), alice).result.answer).toBe("PRIVATE answer");
    expect(() => guardPrivateJobHistoryDetail(detail(), id("2"))).toThrow();
    expect(() => guardPrivateJobHistoryDetail(detail(), id(), bob)).toThrow();
    expect(() => guardPrivateJobHistoryDetail({ ...detail(), result: { ...detail().result, answer: "x".repeat(512 * 1024 + 1) } }, id())).toThrow();
    expect(() => guardPrivateJobHistoryDetail({ ...detail(), result: { ...detail().result,
      evidence: [{ claimIndex: 0, claim: "wrong", marker: "[1]", sourceId: "s", sourceName: "s", quote: "q", support: 1, qualifiesForReward: false }] } }, id())).toThrow();
  });
  it("refuses getters without executing them", () => {
    const getter = vi.fn(() => "PRIVATE"); const raw = page();
    Object.defineProperty(raw.rows[0], "question", { get: getter, enumerable: true });
    expect(() => guardPrivateJobHistoryPage(raw)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it("requires truthful export truncation, finite pages/rows, and no answer fields", () => {
    expect(guardPrivateJobHistoryExport({ ...exported(), complete: false, truncated: true, nextCursor: "continue" }).truncated).toBe(true);
    for (const raw of [{ ...exported(), complete: true, truncated: true }, { ...exported(), nextCursor: "hidden" },
      { ...exported(), pages: 21 }, { ...exported(), rows: Array(501).fill(row()) },
      { ...exported(), rows: [{ ...row(), answer: "PRIVATE" }] }]) expect(() => guardPrivateJobHistoryExport(raw)).toThrow();
  });
  it("CSV matches the existing server serializer; formula text is escaped and NULL stays empty", () => {
    for (const question of ["=SUM(1,2)", " \uFEFF+formula", "-formula", "@formula", 'quote " and\nline']) {
      const value = exported(); value.rows[0].question = question;
      expect(privateJobHistoryMetadataCsv(value)).toBe(privateJobHistoryCsv(value));
      expect(privateJobHistoryMetadataCsv(value)).toContain(',"","",""\r\n');
    }
    const value = exported(); value.complete = false; value.truncated = true; value.nextCursor = "continue";
    expect(privateJobHistoryMetadataCsv(value)).toContain('""truncated"":true');
  });
});
